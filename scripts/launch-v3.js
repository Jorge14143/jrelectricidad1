const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const requiredDocs = [
  "docs/README-V3.md",
  "docs/MANUAL-ADMINISTRADOR-V3.md",
  "docs/MANUAL-CLIENTE-V3.md",
  "docs/MANUAL-PRESUPUESTOS-V3.md",
  "docs/MANUAL-TRABAJOS-V3.md",
  "docs/MANUAL-FINANZAS-V3.md",
  "docs/MANUAL-MATERIALES-V3.md",
  "docs/MANUAL-PRODUCCION-V3.md",
  "docs/CHECKLIST-LANZAMIENTO-V3.md",
  "docs/RELEASE-V3.md"
];

let failed = 0;
for (const file of requiredDocs) {
  const ok = fs.existsSync(path.join(root, file));
  console.log((ok ? "OK " : "FAIL ") + file);
  if (!ok) failed++;
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const checks = [
  ["version 3.0.0", pkg.version === "3.0.0"],
  ["test script", Boolean(pkg.scripts && pkg.scripts.test)],
  ["production check", Boolean(pkg.scripts && pkg.scripts["prod:check"])],
  ["production preflight", Boolean(pkg.scripts && pkg.scripts["prod:preflight"])],
  ["backup", Boolean(pkg.scripts && pkg.scripts.backup)],
  ["health", Boolean(pkg.scripts && pkg.scripts.health)]
];

for (const [name, ok] of checks) {
  console.log((ok ? "OK " : "FAIL ") + name);
  if (!ok) failed++;
}

console.log("\nJR Electricidad V3 launch readiness: " + (failed ? "NOT READY" : "READY"));
process.exit(failed ? 1 : 0);
