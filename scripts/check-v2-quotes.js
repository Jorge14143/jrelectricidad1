const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const server = read("server.js");
const frontend = read("public/js/admin-quotes.js");
const migration = read("migrations/006_quotes.sql");

const checks = [
  ["migration exists", fs.existsSync(path.join(root, "migrations/006_quotes.sql"))],
  ["quote history table", /CREATE TABLE IF NOT EXISTS quote_history/.test(migration)],
  ["quote lifecycle timestamps", /sent_at DATETIME/.test(migration) && /accepted_at DATETIME/.test(migration) && /rejected_at DATETIME/.test(migration)],
  ["admin list", /\/api\/admin\/quotes"/.test(server)],
  ["admin detail", /\/api\/admin\/quotes\/:id/.test(server)],
  ["create quote", /app\.post\("\/api\/admin\/quotes"/.test(server)],
  ["update quote", /app\.put\("\/api\/admin\/quotes\/:id/.test(server)],
  ["status workflow", /app\.patch\("\/api\/admin\/quotes\/:id/.test(server) && /allowedTransitions/.test(server)],
  ["delete draft", /app\.delete\("\/api\/admin\/quotes\/:id/.test(server)],
  ["quote history endpoint", /\/history/.test(server) && /quote_history/.test(server)],
  ["pdf endpoint", /\/api\/admin\/quotes\/:id.*\/pdf/.test(server)],
  ["email sending", /sendQuoteEmail/.test(server)],
  ["frontend create", /\/api\/admin\/quotes/.test(frontend)],
  ["frontend edit", /editQuote/.test(frontend)],
  ["frontend lifecycle actions", /changeQuoteStatus/.test(frontend) && /deleteQuote/.test(frontend)],
  ["public acceptance tracked", /accepted_at = NOW\(\)/.test(server) && /customer_accepted/.test(server)]
];

let failed = false;
for (const [name, ok] of checks) {
  console.log((ok ? "✅" : "❌") + " " + name);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log("✅ Fase 6: estructura de presupuestos V2 validada.");
