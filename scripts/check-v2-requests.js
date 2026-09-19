const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const server = read("server.js");
const migration = read("migrations/005_requests.sql");
const adminHtml = read("public/admin.html");
const adminQuotes = read("public/js/admin-quotes.js");

const checks = [
  ["migration exists", fs.existsSync(path.join(root, "migrations/005_requests.sql"))],
  ["request statuses", /nueva[\s\S]*en_revision[\s\S]*presupuestando[\s\S]*presupuestada[\s\S]*programada[\s\S]*en_trabajo[\s\S]*finalizada[\s\S]*cerrada/.test(server)],
  ["priority", /priority/.test(server) && /priority/.test(migration)],
  ["assignment", /assigned_user_id/.test(server) && /assignees/.test(server)],
  ["scheduled date", /scheduled_at/.test(server)],
  ["internal notes", /internal_notes/.test(server)],
  ["history", /quote_request_history/.test(server) && /\/history/.test(server)],
  ["attachments", /quote_request_attachments/.test(server) && /\/attachments/.test(server)],
  ["convert to quote", /convert-to-quote/.test(server) && /convertRequestToQuote/.test(adminQuotes)],
  ["convert to job", /convert-to-job/.test(server) && /convertRequestToJob/.test(adminQuotes)],
  ["customer notification", /notifyRequestCustomer/.test(server)],
  ["admin UI priority filter", /quoteRequestPriorityFilter/.test(adminHtml)],
  ["admin UI technician filter", /quoteRequestAssignedFilter/.test(adminHtml)],
  ["admin UI management", /saveQuoteRequestManagement/.test(adminQuotes)]
];

let failed = false;
for (const [name, ok] of checks) {
  console.log((ok ? "✅" : "❌") + " " + name);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
console.log("✅ Fase 5: estructura de solicitudes V2 validada.");
