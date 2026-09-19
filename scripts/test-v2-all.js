"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const checkerNames = [
  "check-project.js",
  "check-v2-foundation.js",
  "check-v2-security.js",
  "check-v2-accounts.js",
  "check-v2-clients.js",
  "check-v2-requests.js",
  "check-v2-quotes.js",
  "check-v2-acceptance.js",
  "check-v2-jobs.js",
  "check-v2-gallery.js",
  "check-v2-dashboard.js",
  "check-v2-notifications.js",
  "check-v2-email.js",
  "check-v2-whatsapp.js",
  "check-v2-documents.js",
  "check-v2-search.js",
  "check-v2-configuration.js",
  "check-v2-audit.js",
  "check-v2-backups.js",
  "check-v2-production.js",
  "check-v2-responsive.js"
];

let failed = 0;
for (const name of checkerNames) {
  const file = path.join(root, "scripts", name);
  if (!fs.existsSync(file)) {
    console.error("FAIL: falta checker " + name);
    failed++;
    continue;
  }
  const result = spawnSync(process.execPath, [file], {
    cwd: root,
    encoding: "utf8"
  });
  process.stdout.write("\n=== " + name + " ===\n");
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.status !== 0) failed++;
}

const unit = spawnSync(process.execPath, ["--test", path.join(root, "scripts", "test-v2-unit.js")], {
  cwd: root,
  encoding: "utf8"
});
process.stdout.write("\n=== test-v2-unit.js ===\n");
process.stdout.write(unit.stdout || "");
process.stderr.write(unit.stderr || "");
if (unit.status !== 0) failed++;

if (failed) {
  console.error("\n❌ V2 TEST SUITE: " + failed + " bloque(s) fallaron.");
  process.exit(1);
}

console.log("\n✅ V2 TEST SUITE: todos los checks estáticos y tests unitarios pasaron.");
