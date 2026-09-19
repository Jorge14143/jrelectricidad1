require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { createDatabaseBackup } = require("../lib/backups");
const { runMigrations } = require("../lib/migrations");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const REQUIRED_V2_TABLES = ["users","services","quote_requests","quotes","quote_items","jobs","gallery","admin_notifications","business_settings","documents","document_versions","audit_log","backups","schema_migrations"];
const PRESERVED_TABLES = ["users","services","quote_requests","quotes","quote_items","jobs","gallery","admin_notifications","business_settings"];

function hasFlag(name) { return process.argv.includes(name); }
function log(message) { console.log("[V1→V2]", message); }

function createPool() {
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    charset: "utf8mb4"
  });
}

async function tableExists(pool, table) {
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=? AND table_name=?",
    [process.env.DB_NAME, table]
  );
  return Number(rows[0]?.n || 0) > 0;
}

async function columnExists(pool, table, column) {
  if (!(await tableExists(pool, table))) return false;
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?",
    [process.env.DB_NAME, table, column]
  );
  return Number(rows[0]?.n || 0) > 0;
}

async function rowCount(pool, table) {
  if (!(await tableExists(pool, table))) return null;
  if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error("Tabla inválida.");
  const [rows] = await pool.query("SELECT COUNT(*) AS n FROM " + table);
  return Number(rows[0]?.n || 0);
}

async function snapshot(pool) {
  const counts = {};
  for (const table of PRESERVED_TABLES) counts[table] = await rowCount(pool, table);
  return counts;
}

async function listMigrations(pool) {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(name => /^\d+_.+\.sql$/i.test(name))
    .sort();

  const applied = new Set();
  if (await tableExists(pool, "schema_migrations")) {
    const [rows] = await pool.query("SELECT version FROM schema_migrations");
    for (const row of rows) applied.add(row.version);
  }

  return files.map(file => {
    const version = file.replace(/\.sql$/i, "");
    return { file, version, applied: applied.has(version) };
  });
}

async function preflight(pool) {
  const legacyTablesDetected = [];
  for (const table of PRESERVED_TABLES) {
    if (await tableExists(pool, table)) legacyTablesDetected.push(table);
  }

  const requiredV2TablesMissing = [];
  for (const table of REQUIRED_V2_TABLES) {
    if (!(await tableExists(pool, table))) requiredV2TablesMissing.push(table);
  }

  return {
    database: process.env.DB_NAME,
    legacyTablesDetected,
    requiredV2TablesMissing,
    compatibility: {
      usersPasswordHash: await columnExists(pool, "users", "password_hash"),
      usersRole: await columnExists(pool, "users", "role"),
      jobsJobNumber: await columnExists(pool, "jobs", "job_number"),
      settingsCurrency: await columnExists(pool, "business_settings", "currency_code"),
      documents: await tableExists(pool, "documents")
    },
    migrations: await listMigrations(pool),
    safeToRun: Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME)
  };
}

async function ensureRunTable(pool) {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS v2_migration_runs (" +
    "id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT," +
    "source_label VARCHAR(80) NOT NULL DEFAULT 'V1'," +
    "target_label VARCHAR(80) NOT NULL DEFAULT 'V2'," +
    "mode ENUM('dry-run','migration') NOT NULL," +
    "status ENUM('running','completed','failed') NOT NULL DEFAULT 'running'," +
    "started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP," +
    "completed_at TIMESTAMP NULL," +
    "preflight_json LONGTEXT NULL," +
    "result_json LONGTEXT NULL," +
    "error_message VARCHAR(2000) NULL," +
    "PRIMARY KEY (id)," +
    "KEY idx_v2_migration_runs_started (started_at,id)," +
    "KEY idx_v2_migration_runs_status (status,started_at)" +
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
  );
}

async function createRun(pool, mode, preflight) {
  const [result] = await pool.query(
    "INSERT INTO v2_migration_runs (mode,status,preflight_json) VALUES (?, 'running', ?)",
    [mode, JSON.stringify(preflight)]
  );
  return result.insertId;
}

async function finishRun(pool, id, status, result, errorMessage = null) {
  await pool.query(
    "UPDATE v2_migration_runs SET status=?, completed_at=CURRENT_TIMESTAMP, result_json=?, error_message=? WHERE id=?",
    [status, JSON.stringify(result || {}), errorMessage, id]
  );
}

async function verify(pool, before) {
  const missingRequiredTables = [];
  for (const table of REQUIRED_V2_TABLES) {
    if (!(await tableExists(pool, table))) missingRequiredTables.push(table);
  }

  const after = await snapshot(pool);
  const preserved = {};
  for (const table of PRESERVED_TABLES) {
    preserved[table] = {
      before: before[table],
      after: after[table],
      preserved: before[table] == null || before[table] <= after[table]
    };
  }

  const [admins] = await pool.query(
    "SELECT COUNT(*) AS n FROM users WHERE role='admin'"
  ).catch(() => [[{ n: 0 }]]);

  const [settings] = await pool.query(
    "SELECT COUNT(*) AS n FROM business_settings"
  ).catch(() => [[{ n: 0 }]]);

  return {
    missingRequiredTables,
    preserved,
    adminUsers: Number(admins[0]?.n || 0),
    businessSettingsRows: Number(settings[0]?.n || 0),
    ok:
      missingRequiredTables.length === 0 &&
      Object.values(preserved).every(item => item.preserved) &&
      Number(admins[0]?.n || 0) >= 1
  };
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--yes") || hasFlag("--force");

  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
    throw new Error("Faltan DB_HOST, DB_USER o DB_NAME en .env.");
  }

  if (!dryRun && !force) {
    throw new Error("La migración real requiere --yes. Primero ejecutá --dry-run.");
  }

  const pool = createPool();
  let runId = null;

  try {
    await pool.query("SELECT 1");

    const preflightResult = await preflight(pool);
    await ensureRunTable(pool);
    runId = await createRun(pool, dryRun ? "dry-run" : "migration", preflightResult);

    log("Base: " + preflightResult.database);
    log("Tablas V1 detectadas: " + preflightResult.legacyTablesDetected.length);
    log("Migraciones pendientes: " + preflightResult.migrations.filter(item => !item.applied).length);

    if (preflightResult.requiredV2TablesMissing.length) {
      log("Tablas V2 ausentes: " + preflightResult.requiredV2TablesMissing.join(", "));
    }

    if (dryRun) {
      await finishRun(pool, runId, "completed", {
        dryRun: true,
        pendingMigrations: preflightResult.migrations.filter(item => !item.applied).map(item => item.file),
        requiredV2TablesMissing: preflightResult.requiredV2TablesMissing
      });
      log("DRY-RUN finalizado. No se modificaron datos ni esquema.");
      return;
    }

    const before = await snapshot(pool);

    log("Creando backup obligatorio antes de migrar...");
    const backup = await createDatabaseBackup();
    log("Backup creado: " + backup.filename);

    await runMigrations(pool);

    const verification = await verify(pool, before);
    const result = {
      backup: {
        filename: backup.filename,
        sizeBytes: backup.sizeBytes,
        sha256: backup.sha256
      },
      verification
    };

    if (!verification.ok) {
      throw new Error("La verificación post-migración no pasó: " + JSON.stringify(verification));
    }

    await finishRun(pool, runId, "completed", result);
    log("Migración V1 → V2 completada y verificada.");
  } catch (error) {
    if (runId) {
      await finishRun(pool, runId, "failed", {}, error.message).catch(() => {});
    }
    console.error("[V1→V2] ERROR:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
