const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const required = [
  "lib/logger.js",
  "lib/api.js",
  "lib/validation.js",
  "lib/migrations.js",
  "migrations/001_v2_foundation.sql",
  "scripts/check-v2-foundation.js"
];

const missing = required.filter(file => !fs.existsSync(path.join(root, file)));

if (missing.length) {
  console.error("❌ Faltan archivos de la Fase 1:", missing);
  process.exit(1);
}

for (const file of required.filter(file => file.endsWith(".js"))) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  try {
    new Function(source);
  } catch (error) {
    console.error(`❌ Sintaxis inválida: ${file}`, error.message);
    process.exit(1);
  }
}

const migration = fs.readFileSync(
  path.join(root, "migrations/001_v2_foundation.sql"),
  "utf8"
);

for (const requiredTable of ["audit_log", "login_attempts"]) {
  if (!migration.includes(`CREATE TABLE IF NOT EXISTS ${requiredTable}`)) {
    console.error(`❌ Falta la tabla de migración: ${requiredTable}`);
    process.exit(1);
  }
}

console.log("✅ Fase 1: archivos, módulos y migración base validados.");
