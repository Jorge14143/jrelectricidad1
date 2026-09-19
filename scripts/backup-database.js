require("dotenv").config();

const mysql = require("mysql2/promise");
const { createDatabaseBackup, deleteFileIfExists, getBackupDir, DEFAULT_RETENTION, normalizeRetention } = require("../lib/backups");

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 2,
    charset: "utf8mb4"
  });

  try {
    const backup = await createDatabaseBackup();
    const [result] = await pool.query(
      `INSERT INTO backups
       (filename,storage_path,backup_type,size_bytes,sha256,status,completed_at)
       VALUES (?,?,?,?,?,'completed',CURRENT_TIMESTAMP)`,
      [backup.filename, backup.filePath, "database", backup.sizeBytes, backup.sha256]
    );

    const retentionDays = normalizeRetention(process.env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION);
    const [oldRows] = await pool.query(
      `SELECT id,storage_path FROM backups
       WHERE status='completed' AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY created_at ASC LIMIT 1000`,
      [retentionDays]
    );

    const backupRoot = require("path").resolve(getBackupDir());
    for (const row of oldRows) {
      const p = require("path").resolve(String(row.storage_path || ""));
      if (p !== backupRoot && p.startsWith(backupRoot + require("path").sep)) {
        await deleteFileIfExists(p).catch(() => {});
        await pool.query("UPDATE backups SET status='deleted' WHERE id=?", [row.id]);
      }
    }

    console.log(`[BACKUP] OK #${result.insertId}: ${backup.filename}`);
    console.log(`[BACKUP] Tamaño: ${backup.sizeBytes} bytes`);
    console.log(`[BACKUP] SHA-256: ${backup.sha256}`);
    console.log(`[BACKUP] Retención: ${retentionDays} días`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error("[BACKUP] ERROR:", error.message);
  process.exitCode = 1;
});
