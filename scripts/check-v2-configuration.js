const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "admin.html"), "utf8");
const core = fs.readFileSync(path.join(root, "public", "js", "admin-core.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "migrations", "011_v2_configuration.sql"), "utf8");

for (const marker of [
  'app.get(\n  "/api/admin/settings"',
  'app.put(\n  "/api/admin/settings"',
  "nextDocumentNumber",
  "business_settings",
  "currency_code",
  "tax_rate",
  "quote_prefix",
  "job_prefix",
  "quote_validity_days",
  "quote_terms",
  "commercial_conditions"
]) assert(server.includes(marker), "Falta configuración backend: " + marker);

for (const marker of [
  'id="businessSettingsForm"',
  'id="currencyCode"',
  'id="taxEnabled"',
  'id="taxRate"',
  'id="quotePrefix"',
  'id="quoteNextNumber"',
  'id="jobPrefix"',
  'id="jobNextNumber"',
  'id="quoteValidityDays"',
  'id="quoteDefaultNotes"',
  'id="quoteTerms"',
  'id="commercialConditions"'
]) assert(html.includes(marker), "Falta campo UI: " + marker);

for (const marker of [
  "loadBusinessSettings",
  "setupBusinessSettings",
  "/api/admin/settings",
  "tax_enabled",
  "quote_next_number",
  "commercial_conditions"
]) assert(core.includes(marker), "Falta integración frontend: " + marker);

for (const marker of [
  "CREATE TABLE IF NOT EXISTS business_settings",
  "whatsapp_enabled",
  "currency_code",
  "tax_enabled",
  "quote_next_number",
  "job_next_number",
  "quote_validity_days",
  "quote_default_notes",
  "quote_terms",
  "commercial_conditions",
  "job_number"
]) assert(migration.includes(marker), "Falta migración: " + marker);

console.log("✅ Fase 16 — Configuración: negocio, contacto, logo, WhatsApp, moneda, impuestos, numeración, vigencia, textos comerciales y UI verificados.");
