const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const required = ["lib/v3.js", "migrations/016_v3_foundation.sql", "docs/V3-PHASE-01-04.md"];
const missing = required.filter(file => !fs.existsSync(path.join(root, file)));
if (missing.length) { console.error("❌ Faltan archivos:", missing.join(", ")); process.exit(1); }

const v3 = fs.readFileSync(path.join(root, "lib/v3.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const migration = fs.readFileSync(path.join(root, "migrations/016_v3_foundation.sql"), "utf8");
const checks = [
  ["V3_VERSION", /V3_VERSION\s*=\s*"3\.0\.0"/.test(v3)],
  ["API V3", /\/api\/v3/.test(v3)],
  ["Health V3", /router\.get\("\/health"/.test(v3)],
  ["Meta V3", /router\.get\("\/meta"/.test(v3)],
  ["Tabla v3_system", /CREATE TABLE IF NOT EXISTS v3_system/i.test(migration)],
  ["Tabla v3_api_clients", /CREATE TABLE IF NOT EXISTS v3_api_clients/i.test(migration)],
  ["Router V3 montado", /app\.use\("\/api\/v3", createV3Router\(express, pool\)\)/.test(server)],
  ["Versión package 3.0.0", pkg.version === "3.0.0"],
  ["Checker npm V3", pkg.scripts?.["test:v3-foundation"] === "node scripts/check-v3-foundation.js"]
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log((ok ? "✅ " : "❌ ") + name);
if (failed.length) process.exit(1);
console.log("✅ Bloque A — Fundación V3: 100% estructurado.");
