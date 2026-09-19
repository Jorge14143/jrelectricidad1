const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const required = [
  "server.js",
  "finance-routes.js",
  "materials-routes.js",
  "whatsapp-routes.js",
  "schema.sql",
  "public/index.html",
  "public/admin.html",
  "public/login.html",
  "public/register.html",
  "public/forgot-password.html",
  "public/reset-password.html",
  "public/cuenta.html",
  "public/finanzas.html",
  "public/presupuesto.html",
  "public/js/auth-core.js",
  "public/js/auth-login.js",
  "public/js/auth-register.js",
  "public/js/auth-recovery.js",
  "public/js/account.js",
  "public/js/admin-core.js",
  "public/js/admin-bootstrap.js",
  "public/js/admin-dashboard.js",
  "public/js/admin-gallery.js",
  "public/js/admin-jobs.js",
  "public/js/admin-materials.js",
  "public/js/admin-whatsapp.js",
  "public/js/admin-navigation.js",
  "public/js/admin-notifications.js",
  "public/js/admin-quotes.js",
  "public/js/admin-services.js",
  "public/js/admin-users.js",
  "public/js/finanzas.js",
  "public/css/finanzas.css",
  "public/css/materials.css",
  "public/css/whatsapp.css",
  "public/js/gallery.js",
  "public/js/home-services.js",
  "public/js/public-quote.js",
  "public/js/quote-request.js",
  "public/js/site-settings.js",
  "public/js/user-menu.js"
];

const missing = required.filter(file => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error("Archivos requeridos faltantes:");
  missing.forEach(file => console.error(" - " + file));
  process.exit(1);
}

function collectJs(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "uploads") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...collectJs(full));
    else if (entry.isFile() && full.endsWith(".js")) result.push(full);
  }
  return result;
}

let failed = false;
for (const file of collectJs(root)) {
  const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (check.status !== 0) {
    failed = true;
    console.error("\n❌ Sintaxis inválida: " + path.relative(root, file));
    if (check.stderr) console.error(check.stderr.trim());
  }
}

if (failed) process.exit(1);

console.log("✅ Proyecto validado: archivos requeridos y sintaxis JavaScript correcta.");
