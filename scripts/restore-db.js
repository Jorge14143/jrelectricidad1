require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const file = process.argv[2];
if (!file) { console.error("Uso: node scripts/restore-db.js <backup.sql>"); process.exit(1); }

const fullPath = path.resolve(file);
if (!fs.existsSync(fullPath)) { console.error("❌ Backup no encontrado: " + fullPath); process.exit(1); }

const required = ["DB_HOST", "DB_USER", "DB_NAME"];
const missing = required.filter(key => !String(process.env[key] || "").trim());
if (missing.length) { console.error("❌ Faltan variables: " + missing.join(", ")); process.exit(1); }

if (process.env.CONFIRM_RESTORE !== "YES") {
  console.error("Para confirmar: CONFIRM_RESTORE=YES node scripts/restore-db.js <backup.sql>");
  process.exit(2);
}

const result = spawnSync("mysql", [
  "--host=" + process.env.DB_HOST,
  "--port=" + String(process.env.DB_PORT || 3306),
  "--user=" + process.env.DB_USER,
  process.env.DB_NAME
], {
  stdio: ["pipe", "inherit", "inherit"],
  input: fs.readFileSync(fullPath),
  env: { ...process.env, MYSQL_PWD: String(process.env.DB_PASSWORD || "") }
});
if (result.status !== 0) process.exit(result.status || 1);
console.log("✅ Base restaurada correctamente.");
