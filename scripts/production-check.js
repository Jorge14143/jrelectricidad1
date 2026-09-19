const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const required = [
  "ecosystem.config.js",
  "deploy/nginx/jrelectricidad.conf",
  ".env.production.example",
  "scripts/backup-db.js",
  "scripts/restore-db.js",
  "scripts/production-preflight.js",
  "scripts/monitor-health.js",
  "docs/PRODUCCION-V3.md"
];

let failed = 0;
for (const file of required) {
  const ok = fs.existsSync(path.join(root, file));
  console.log((ok ? "✅ " : "❌ ") + file);
  if (!ok) failed++;
}

const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const checks = [
  ["health endpoint", server.includes('app.get("/health"')],
  ["graceful SIGTERM", server.includes('process.on("SIGTERM"')],
  ["production start failure handling", server.includes('start().catch')],
  ["PM2 ecosystem script", fs.existsSync(path.join(root, "ecosystem.config.js"))],
  ["backup npm script", packageJson.scripts?.backup === "node scripts/backup-db.js"],
  ["restore npm script", packageJson.scripts?.restore === "node scripts/restore-db.js"],
  ["health npm script", packageJson.scripts?.health === "node scripts/monitor-health.js"],
  ["preflight npm script", packageJson.scripts?.["prod:preflight"] === "node scripts/production-preflight.js"],
  ["backup ignored", fs.readFileSync(path.join(root, ".gitignore"), "utf8").includes("backups/")
];

for (const [name, ok] of checks) {
  console.log((ok ? "✅ " : "❌ ") + name);
  if (!ok) failed++;
}

console.log("\nProducción V3: " + (failed ? "NO COMPLETA" : "OK"));
process.exit(failed ? 1 : 0);
