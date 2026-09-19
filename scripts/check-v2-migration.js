const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const migration = fs.readFileSync(path.join(__dirname, "migrate-v1-to-v2.js"), "utf8");
const docs = fs.readFileSync(path.join(root, "docs", "V2-PHASE-22.md"), "utf8");
const sql = fs.readFileSync(path.join(root, "migrations", "015_v2_migration.sql"), "utf8");
const runner = fs.readFileSync(path.join(root, "lib", "migrations.js"), "utf8");

for (const script of ["migration:v1-v2","migration:v1-v2:dry-run","test:v2-migration"]) {
  assert(pkg.scripts?.[script], "Falta script npm: " + script);
}
for (const token of ["--dry-run","--yes","createDatabaseBackup","runMigrations","preflight","requiredV2TablesMissing","verify","v2_migration_runs"]) {
  assert(migration.includes(token), "Falta control de migración: " + token);
}
for (const token of ["v2_migration_runs","status","preflight_json","result_json","error_message"]) {
  assert(sql.includes(token), "Falta estructura de trazabilidad: " + token);
}
for (const token of ["V1 → V2","backup","dry-run","rollback","verificación","usuarios","preserv","uploads","documentos"]) {
  assert(docs.toLowerCase().includes(token.toLowerCase()), "Falta documentación: " + token);
}
assert(runner.includes("schema_migrations"), "El runner no conserva historial de migraciones.");
console.log("OK - checker estructural Fase 22");
