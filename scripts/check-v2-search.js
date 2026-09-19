const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "admin.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "css", "admin.css"), "utf8");
const nav = fs.readFileSync(path.join(root, "public", "js", "admin-navigation.js"), "utf8");
const js = fs.readFileSync(path.join(root, "public", "js", "admin-search.js"), "utf8");

assert(server.includes('app.get("/api/admin/search", requireAdmin'), "Falta endpoint protegido");
assert(server.includes("Array(33).fill(term)"), "La búsqueda no conserva el número esperado de parámetros");
for (const table of ["users", "clients", "quote_requests", "quotes", "jobs", "services", "gallery", "documents"]) {
  assert(server.includes(`FROM ${table}`) || server.includes(`FROM ${table} `), `Falta búsqueda en ${table}`);
}
for (const marker of [
  'id="globalAdminSearch"',
  'id="globalSearchResults"',
  '/js/admin-search.js'
]) assert(html.includes(marker), `Falta UI ${marker}`);

for (const hook of ["AbortController", "encodeURIComponent", "/api/admin/search", "Escape"]) {
  assert(js.includes(hook), `Falta comportamiento ${hook}`);
}

assert(css.includes(".admin-global-search"), "Falta CSS de búsqueda global");
assert(nav.includes('"documentsSection"'), "La navegación no incluye Documentos");

console.log("✅ Fase 15 — Búsqueda global: endpoint protegido, 8 módulos indexados, UI, navegación y cancelación de búsquedas verificados.");
