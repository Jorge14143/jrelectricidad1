const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const required = [
  "lib/v3.js",
  "migrations/018_v3_client_portal.sql",
  "public/portal.html",
  "public/js/v3-client.js",
  "public/css/v3-client.css",
  "docs/V3-BLOCK-C.md"
];
const failures = [];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) failures.push("Falta " + file);
}
const v3 = fs.readFileSync(path.join(root, "lib/v3.js"), "utf8");
const portal = fs.readFileSync(path.join(root, "public/portal.html"), "utf8");
const js = fs.readFileSync(path.join(root, "public/js/v3-client.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/css/v3-client.css"), "utf8");
const sql = fs.readFileSync(path.join(root, "migrations/018_v3_client_portal.sql"), "utf8");
const checks = [
  [v3.includes('"/client/overview"'), "API dashboard cliente"],
  [v3.includes('"/client/profile"'), "API perfil cliente"],
  [v3.includes('"/client/requests"'), "API solicitudes"],
  [v3.includes('"/client/quotes"'), "API presupuestos"],
  [v3.includes('"/client/jobs"'), "API trabajos"],
  [v3.includes('"/client/documents"'), "API documentos"],
  [v3.includes('"/client/activity"'), "API actividad"],
  [v3.includes('"/client/notifications"'), "API notificaciones"],
  [sql.includes("v3_client_profiles"), "tabla perfiles"],
  [sql.includes("v3_client_links"), "tabla vínculos"],
  [sql.includes("v3_client_notifications"), "tabla notificaciones"],
  [portal.includes("requestForm"), "formulario solicitudes"],
  [portal.includes("profileForm"), "formulario perfil"],
  [portal.includes("quotesList"), "lista presupuestos"],
  [portal.includes("jobsList"), "lista trabajos"],
  [portal.includes("documentsList"), "lista documentos"],
  [js.includes("/api/v3/client/overview"), "cliente JS dashboard"],
  [js.includes("/api/v3/client/quotes/"), "cliente JS decisiones"],
  [css.includes("@media"), "responsive portal"]
];
for (const [ok, label] of checks) if (!ok) failures.push(label);
try { new Function(v3.replace(/^"use strict";/, "")); } catch (e) { failures.push("Sintaxis JavaScript de lib/v3.js: " + e.message); }
try { new Function(js); } catch (e) { failures.push("Sintaxis JavaScript de v3-client.js: " + e.message); }
if (failures.length) {
  console.error("❌ Bloque C — errores:");
  failures.forEach(x => console.error(" - " + x));
  process.exit(1);
}
console.log("✅ Bloque C — Portal Cliente V3: 100% estructurado.");
console.log("   Fases 14-21 verificadas: portal, perfil, dashboard, solicitudes, presupuestos, trabajos, documentos y notificaciones/actividad.");
