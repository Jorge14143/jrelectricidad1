const fs = require("fs");
const path = require("path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const migration = fs.readFileSync(path.join(__dirname, "..", "migrations", "007_quote_acceptance.sql"), "utf8");
const page = fs.readFileSync(path.join(__dirname, "..", "public", "presupuesto.html"), "utf8");

assert(migration.includes("CREATE TABLE IF NOT EXISTS quote_acceptances"), "Falta tabla quote_acceptances");
assert(server.includes("/api/public/quotes/:token/accept"), "Falta endpoint de aceptación");
assert(server.includes("/api/public/quotes/:token/reject"), "Falta endpoint de rechazo");
assert(server.includes("processPublicQuoteDecision"), "Falta flujo central de decisión");
assert(server.includes("ACCEPTANCE_CONSENT_TEXT"), "Falta consentimiento digital");
assert(server.includes("req.ip"), "Falta evidencia de IP");
assert(server.includes("user-agent"), "Falta evidencia de user-agent");
assert(server.includes("/presupuesto/:token"), "Falta página pública del presupuesto");
assert(server.includes("INSERT INTO jobs"), "Falta integración automática con trabajos");
assert(server.includes("admin_notifications"), "Falta notificación al administrador");
assert(page.includes("/api/public/quotes/"), "La página pública no consume el endpoint");
assert(page.includes("consent"), "La página no incluye consentimiento");
assert(page.includes("signatureName"), "La página no incluye firma digital");

console.log("Fase 7 OK: aceptación digital, evidencia, notificaciones, trabajo y página pública.");
