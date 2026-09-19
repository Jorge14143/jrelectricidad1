const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "migrations", "013_documents.sql"), "utf8");
const lib = fs.readFileSync(path.join(root, "lib", "documents.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "admin.html"), "utf8");
const js = fs.readFileSync(path.join(root, "public", "js", "admin-documents.js"), "utf8");

for (const table of ["documents","document_versions"]) assert(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `Falta tabla ${table}`);
for (const field of ["document_type","client_id","quote_request_id","quote_id","job_id","current_version"]) assert(migration.includes(field), `Falta campo ${field}`);
for (const helper of ["normalizeDocumentType","sha256File","validateDocumentSignature"]) assert(lib.includes(helper), `Falta helper ${helper}`);
for (const route of [
  "/api/admin/documents",
  "/api/admin/documents/:id",
  "/api/admin/documents/:id",
  "/api/admin/documents/:id",
  "/download",
  "/versions",
  "/api/admin/documents/from-quote/:quoteId",
  "/api/admin/documents/from-job/:jobId"
]) assert(server.includes(route), `Falta ruta ${route}`);
for (const id of ["documentsSection","documentsList","documentsSearch","documentsTypeFilter","documentUploadForm"]) assert(html.includes(`id="${id}"`), `Falta UI ${id}`);
for (const hook of ["loadDocuments","uploadDocument","downloadDocument","createQuoteDocument","createJobDocument"]) assert(js.includes(hook), `Falta hook ${hook}`);
console.log("✅ Fase 14 — Documentos: estructura, seguridad, rutas y UI verificadas.");
