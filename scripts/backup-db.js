require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const required = ["DB_HOST", "DB_USER", "DB_NAME"];
const missing = required.filter(key => !String(process.env[key] || "").trim());
if (missing.length) { console.error("❌ Faltan variables: " + missing.join(", ")); process.exit(1); }

const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, "..", "backups"));
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(backupDir, "jr_electricidad_" + stamp + ".sql");

const result = spawnSync("mysqldump", [
  "--host=" + process.env.DB_HOST,
  "--port=" + String(process.env.DB_PORT || 3306),
  "--user=" + process.env.DB_USER,
  "--single-transaction",
  "--routines",
  "--events",
  "--triggers",
  process.env.DB_NAME
], {
  encoding: "utf8",
  env: { ...process.env, MYSQL_PWD: String(process.env.DB_PASSWORD || "") },
  maxBuffer: 100 * 1024 * 1024
});

if (result.status !== 0) {
  console.error("❌ mysqldump falló.");
  console.error(result.stderr || "");
  process.exit(result.status || 1);
}
fs.writeFileSync(output, result.stdout, "utf8");
console.log("✅ Backup creado: " + output);
