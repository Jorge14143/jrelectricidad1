const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const checks = [
  ["public/admin.html", [
    'name="viewport"',
    'id="adminMobileMenu"',
    'id="adminSidebar"',
    'id="adminMobileBackdrop"'
  ]],
  ["public/js/admin-navigation.js", [
    "setupAdminMobileNavigation",
    "admin-mobile-menu-open",
    "Escape"
  ]],
  ["public/css/admin.css", [
    "FASE 20 — RESPONSIVE / UX",
    "admin-mobile-menu-open",
    "admin-mobile-backdrop",
    "prefers-reduced-motion"
  ]],
  ["public/css/style.css", [
    "FASE 20 — RESPONSIVE / UX PÚBLICO",
    "prefers-reduced-motion",
    "max-width: 680px"
  ]],
  ["public/index.html", [
    'name="viewport"',
    'id="services"',
    'id="gallery"',
    'id="quoteForm"'
  ]]
];

let failures = 0;

for (const [file, needles] of checks) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    console.error("FAIL:", file, "no existe");
    failures++;
    continue;
  }

  const content = fs.readFileSync(full, "utf8");

  for (const needle of needles) {
    if (!content.includes(needle)) {
      console.error("FAIL:", file, "falta:", needle);
      failures++;
    }
  }
}

if (failures) {
  console.error("\nFase 20: FAIL —", failures, "comprobaciones.");
  process.exit(1);
}

console.log("Fase 20: PASS — responsive/UX estructural verificado.");
