const fs = require("fs");
const path = require("path");

async function runMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir)
    .filter(name => /^\\d+_.+\\.sql$/i.test(name))
    .sort();

  for (const file of files) {
    const version = file.replace(/\\.sql$/i, "");
    const [rows] = await pool.query(
      "SELECT version FROM schema_migrations WHERE version=? LIMIT 1",
      [version]
    );

    if (rows.length) continue;

    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const statements = sql
      .split(";")
      .map(statement => statement.trim())
      .filter(Boolean);

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      for (const statement of statements) {
        await connection.query(statement);
      }
      await connection.query(
        "INSERT INTO schema_migrations (version) VALUES (?)",
        [version]
      );
      await connection.commit();
      console.log(`[MIGRATION] Aplicada: ${version}`);
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw new Error(`Falló la migración ${version}: ${error.message}`);
    } finally {
      connection.release();
    }
  }
}

module.exports = { runMigrations };
