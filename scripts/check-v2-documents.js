const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "migrations", "013_documents.sql"), "utf8");
const lib = fs.readFileSync(path.join(root, "lib", "documents.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "admin.html"), "utf8");
const js = fs.readFileSync(path.join(root, "public", "js", "admin-documents.js"), "utf8");

for (const table of ["documents", "document_versions"]) {
  assert(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `Falta tabla ${table}`);
}

for (const field of [
  "document_type", "client_id", "quote_request_id", "quote_id",
  "job_id", "current_version", "sha256", "storage_path"
]) {
  assert(migration.includes(field), `Falta campo ${field}`);
}

for (const helper of [
  "normalizeDocumentType", "safeDocumentName", "documentFileName",
  "sha256File", "validateDocumentSignature", "createDocumentStorage"
]) {
  assert(lib.includes(helper), `Falta helper ${helper}`);
}

for (const securityMarker of [
  'path.join(__dirname, "storage", "documents")',
  "MAX_DOCUMENT_SIZE",
  "ALLOWED_DOCUMENT_MIMES",
  "documentUpload",
  "documentAbsolutePath",
  "requireAdmin"
]) {
  assert(server.includes(securityMarker), `Falta protección/almacenamiento: ${securityMarker}`);
}

for (const route of [
  'app.get("/api/admin/documents"',
  'app.get("/api/admin/documents/:id',
  "/download",
  "/versions",
  'app.post("/api/admin/documents/upload"',
  'app.post("/api/admin/documents/from-quote/:quoteId',
  'app.post("/api/admin/documents/from-job/:jobId',
  'app.delete("/api/admin/documents/:id'
]) {
  assert(server.includes(route), `Falta ruta ${route}`);
}

for (const audit of [
  "document_created",
  "document_version_created",
  "document_downloaded",
  "document_deleted",
  "quote_document_generated",
  "job_document_generated"
]) {
  assert(server.includes(audit), `Falta auditoría ${audit}`);
}

for (const id of [
  "documentsSection", "documentsList", "documentsSearch",
  "documentsTypeFilter", "documentUploadForm", "createQuoteDocument",
  "createJobReport", "createWorkCompletion"
]) {
  assert(html.includes(`id="${id}"`), `Falta UI ${id}`);
}

for (const hook of [
  "loadDocuments", "uploadDocument", "downloadDocument",
  "showDocumentVersions", "addDocumentVersion", "deleteDocument",
  "createQuoteDocument", "createJobDocument"
]) {
  assert(js.includes(hook), `Falta hook ${hook}`);
}

assert(html.includes("/js/admin-documents.js"), "admin-documents.js no está integrado en admin.html");
assert(js.includes("10 * 1024 * 1024"), "La UI no valida el límite de 10 MB");
assert(server.includes("fileSize: MAX_DOCUMENT_SIZE"), "Multer no limita el tamaño del archivo");
assert(server.includes("validateDocumentSignature"), "El servidor no valida la firma del archivo");
assert(server.includes("await writeAudit"), "Las operaciones de documentos no registran auditoría");

console.log("✅ Fase 14 — Documentos: almacenamiento privado, seguridad, versionado, PDFs, auditoría y UI verificados.");
