const crypto = require("crypto");

function createRequestId() {
  return crypto.randomUUID();
}

function serializeMeta(meta) {
  if (meta === undefined) return "";
  try {
    return " " + JSON.stringify(meta);
  } catch {
    return " " + String(meta);
  }
}

function log(level, message, meta) {
  const line = `[${new Date().toISOString()}] [${String(level).toUpperCase()}] ${message}${serializeMeta(meta)}`;
  const method = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  method(line);
}

module.exports = {
  createRequestId,
  info(message, meta) { log("info", message, meta); },
  warn(message, meta) { log("warn", message, meta); },
  error(message, meta) { log("error", message, meta); }
};
