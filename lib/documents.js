const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DOCUMENT_TYPES = Object.freeze({
  quote_pdf: "Presupuesto PDF",
  job_report: "Informe de trabajo",
  work_completion: "Constancia de trabajo",
  client_attachment: "Adjunto de cliente",
  request_attachment: "Adjunto de solicitud",
  other: "Otro"
});

const ALLOWED_DOCUMENT_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

function normalizeDocumentType(value) {
  const type = String(value || "other").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(DOCUMENT_TYPES, type) ? type : null;
}

function safeDocumentName(value) {
  const name = path.basename(String(value || "documento"));
  return name.replace(/[^a-zA-Z0-9._() -]/g, "_").slice(0, 255) || "documento";
}

function documentFileName(originalName) {
  const ext = path.extname(String(originalName || "")).toLowerCase();
  return Date.now() + "-" + crypto.randomBytes(12).toString("hex") + ext;
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

function validateDocumentSignature(buffer, mime) {
  if (!buffer || buffer.length < 4) return false;
  if (mime === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mime === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mime === "image/gif") {
    const s = buffer.subarray(0, 6).toString("ascii");
    return s === "GIF87a" || s === "GIF89a";
  }
  if (mime === "image/webp") {
    return buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (mime === "text/plain") return true;
  if (mime.startsWith("application/vnd.openxmlformats-")) {
    return buffer.subarray(0, 2).toString("binary") === "PK";
  }
  if (mime === "application/msword" || mime === "application/vnd.ms-excel") {
    return buffer.subarray(0, 8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
  }
  return false;
}

function createDocumentStorage(root) {
  const dir = path.resolve(root);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = {
  DOCUMENT_TYPES,
  ALLOWED_DOCUMENT_MIMES,
  MAX_DOCUMENT_SIZE,
  normalizeDocumentType,
  safeDocumentName,
  documentFileName,
  sha256File,
  validateDocumentSignature,
  createDocumentStorage
};
