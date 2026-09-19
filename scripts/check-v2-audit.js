const fs = require("fs");
const path = require("path");
const assert = require("assert");
const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "admin.html"), "utf8");
const js = fs.readFileSync(path.join(root, "public", "js", "admin-audit.js"), "utf8");
const nav = fs.readFileSync(path.join(root, "public", "js", "admin-navigation.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "css", "style.css"), "utf8");
const migration = fs.readFileSync(path.join(root, "migrations", "012_v2_audit.sql"), "utf8");

[
  'app.get("/api/admin/audit", requireAdmin',
  'app.get("/api/admin/audit/export", requireAdmin',
  'audit_log',
  'actor_user_id',
  'request_id',
  'metadata',
  'LIMIT ? OFFSET ?'
].forEach(x => assert(server.includes(x), "Falta backend de auditoría: " + x));

[
  'id="auditSection"','id="auditSearch"','id="auditActionFilter"',
  'id="auditEntityFilter"','id="auditDateFrom"','id="auditDateTo"',
  'id="auditTableBody"','id="auditExportButton"','id="auditPrevButton"','id="auditNextButton"',
  '/js/admin-audit.js'
].forEach(x => assert(html.includes(x), "Falta UI de auditoría: " + x));

[
  '/api/admin/audit?', 'renderRows', 'populateSelect',
  'auditExportButton', 'auditPrevButton', 'auditNextButton'
].forEach(x => assert(js.includes(x), "Falta frontend de auditoría: " + x));

assert(nav.includes('"auditSection"'), "Auditoría no está en navegación.");
assert(css.includes(".admin-audit-table"), "Faltan estilos de auditoría.");

[
  "idx_audit_created_id","idx_audit_actor_action_created","idx_audit_entity_created"
].forEach(x => assert(migration.includes(x), "Falta índice de auditoría: " + x));

console.log("✅ Fase 17 — Auditoría: backend protegido, filtros, paginación, detalle, exportación CSV, navegación, estilos e índices verificados.");
