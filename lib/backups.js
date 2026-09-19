const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const DEFAULT_RETENTION = 30;
const MAX_BACKUPS = 100;

function getBackupDir() {
  const configured = String(process.env.BACKUP_DIR || "").trim();
  return path.resolve(configured || path.join(process.cwd(), "storage", "backups"));
}

function safeBackupFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `jr-electricidad-${stamp}-${crypto.randomBytes(5).toString("hex")}.sql`;
}

function mysqlDumpArgs(outputFile) {
  const args = [
    "--single-transaction",
    "--quick",
    "--routines",
    "--triggers",
    "--events",
    "--hex-blob",
    "--default-character-set=utf8mb4",
    "--host", String(process.env.DB_HOST || "localhost"),
    "--port", String(Number(process.env.DB_PORT || 3306)),
    "--user", String(process.env.DB_USER || ""),
    "--result-file", outputFile,
    String(process.env.DB_NAME || "")
  ];
  return args;
}

function runMysqlDump(outputFile) {
  return new Promise((resolve, reject) => {
    const executable = process.env.MYSQLDUMP_PATH || "mysqldump";
    const env = { ...process.env };
    if (process.env.DB_PASSWORD != null) env.MYSQL_PWD = process.env.DB_PASSWORD;

    const child = spawn(executable, mysqlDumpArgs(outputFile), {
      env,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on("error", error => reject(error));
    child.on("close", code => {
      if (code === 0) return resolve();
      reject(new Error(stderr.trim() || `mysqldump finalizó con código ${code}`));
    });
  });
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function createDatabaseBackup() {
  await fs.promises.mkdir(getBackupDir(), { recursive: true });
  const filename = safeBackupFilename();
  const filePath = path.join(getBackupDir(), filename);
  await runMysqlDump(filePath);
  const stat = await fs.promises.stat(filePath);
  const sha256 = await sha256File(filePath);
  return { filename, filePath, sizeBytes: stat.size, sha256 };
}

async function deleteFileIfExists(filePath) {
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function normalizeRetention(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_RETENTION;
  return Math.max(1, Math.min(3650, Math.trunc(n)));
}

module.exports = {
  DEFAULT_RETENTION,
  MAX_BACKUPS,
  getBackupDir,
  createDatabaseBackup,
  deleteFileIfExists,
  normalizeRetention,
  sha256File
};
