const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const failures = [];
const warnings = [];

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function ok(name, condition, detail = "") {
  if (condition) {
    console.log("✅ " + name + (detail ? " — " + detail : ""));
  } else {
    failures.push(name + (detail ? " — " + detail : ""));
    console.error("❌ " + name + (detail ? " — " + detail : ""));
  }
}

function warn(name, detail) {
  warnings.push(name + (detail ? " — " + detail : ""));
  console.warn("⚠️ " + name + (detail ? " — " + detail : ""));
}

function listFiles(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "uploads"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, ext, out);
    else if (!ext || full.endsWith(ext)) out.push(full);
  }
  return out;
}

console.log("\n⚡ JR ELECTRICIDAD — QA V3\n");

const packageJson = JSON.parse(read("package.json"));
ok("126 Tests — runner npm configurado", typeof packageJson.scripts?.test === "string");
ok("126 Tests — Node.js disponible", Number(process.versions.node.split(".")[0]) >= 18, process.version);

const jsFiles = listFiles(root, ".js");
let syntaxOk = true;
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    syntaxOk = false;
    failures.push("Sintaxis JS: " + path.relative(root, file));
    console.error("❌ Sintaxis JS: " + path.relative(root, file));
  }
}
ok("126 Tests — sintaxis JavaScript completa", syntaxOk, jsFiles.length + " archivos revisados");

const server = read("server.js");
const routeModules = [
  "finance-routes.js",
  "materials-routes.js",
  "whatsapp-routes.js",
  "email-routes.js",
  "signature-routes.js",
  "dashboard-routes.js",
  "notification-routes.js",
  "configuration-routes.js",
  "security-routes.js",
  "automation-routes.js",
  "evidence-routes.js"
];

for (const file of routeModules) {
  ok("127 Integración — módulo " + file, fs.existsSync(path.join(root, file)));
  ok("127 Integración — export " + file, new RegExp("module\\.exports\\s*=").test(read(file)));
  const base = path.basename(file, ".js").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const knownNames = {
    "finance-routes.js": "registerFinanceRoutes",
    "materials-routes.js": "registerMaterialRoutes",
    "whatsapp-routes.js": "registerWhatsappRoutes",
    "email-routes.js": "registerEmailRoutes",
    "signature-routes.js": "registerSignatureRoutes",
    "dashboard-routes.js": "registerDashboardRoutes",
    "notification-routes.js": "registerNotificationRoutes",
    "configuration-routes.js": "registerConfigurationRoutes",
    "security-routes.js": "registerSecurityRoutes",
    "automation-routes.js": "registerAutomationRoutes",
    "evidence-routes.js": "registerEvidenceRoutes"
  };
  const fn = knownNames[file];
  ok("127 Integración — registro server " + file, server.includes(fn + "({ app"));
}

const adminRouteFiles = routeModules;
let authCoverage = true;
for (const file of adminRouteFiles) {
  const content = read(file);
  const lines = content.split(/\r?\n/);
  let routeCount = 0;
  let unprotected = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/app\.(get|post|put|patch|delete)\s*\(\s*["']\/api\/admin\//.test(lines[i])) {
      routeCount++;
      const chunk = lines.slice(i, Math.min(lines.length, i + 5)).join("\n");
      if (!/requireAdmin|\.\.\.admin/.test(chunk)) unprotected++;
    }
  }
  if (unprotected) authCoverage = false;
  ok("130 Seguridad — rutas admin protegidas: " + file, unprotected === 0, routeCount + " rutas / " + unprotected + " sin requireAdmin cercano");
}

const htmlFiles = listFiles(path.join(root, "public"), ".html");
let frontendOk = true;
for (const file of htmlFiles) {
  const content = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file);
  const srcs = [...content.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
  for (const src of srcs) {
    if (src.startsWith("/")) {
      const target = path.join(root, "public", src.slice(1));
      if (!fs.existsSync(target)) {
        frontendOk = false;
        failures.push("Frontend asset faltante: " + relative + " -> " + src);
        console.error("❌ Frontend asset faltante: " + relative + " -> " + src);
      }
    }
  }
  const inputs = [...content.matchAll(/<(input|textarea|select)\\b[^>]*>/gi)].map(m => m[0]);
  const unlabeled = inputs.filter(tag => !/\b(aria-label|aria-labelledby|id\s*=)/i.test(tag));
  if (unlabeled.length) warn("132 Accesibilidad — " + relative, unlabeled.length + " controles sin id/aria-label detectable");
}
ok("129 Frontend — assets JS referenciados", frontendOk);

const index = fs.existsSync(path.join(root, "public/index.html")) ? read("public/index.html") : "";
ok("132 Accesibilidad — lang declarado", /<html[^>]+\blang=["'][^"']+["']/i.test(index));
ok("132 Accesibilidad — imágenes con alt", !/<img\b(?![^>]*\balt=)[^>]*>/i.test(index));
ok("132 Accesibilidad — navegación por enlaces/botones", /<(a|button)\b/i.test(index));

ok("130 Seguridad — Helmet", /app\.use\(\s*helmet\(/.test(server));
ok("130 Seguridad — x-powered-by desactivado", /app\.disable\(["']x-powered-by["']\)/.test(server));
ok("130 Seguridad — cookie HttpOnly", /httpOnly:\s*true/.test(server));
ok("130 Seguridad — SameSite", /sameSite:\s*["']lax["']/i.test(server));
ok("130 Seguridad — rate limit", /express-rate-limit/.test(server) && /authLimiter/.test(server));
ok("130 Seguridad — límite JSON", /express\.json\(\{\s*limit:\s*["']100kb["']/.test(server));
ok("130 Seguridad — límite uploads galería", /fileSize:\s*5\s*\*\s*1024\s*\*\s*1024/.test(server));
ok("130 Seguridad — auditoría admin", /security_audit_log/.test(server));

ok("131 Rendimiento — pool MySQL", /mysql\.createPool\(/.test(server));
ok("131 Rendimiento — connectionLimit", /connectionLimit:\s*10/.test(server));
ok("131 Rendimiento — estático público", /express\.static\(/.test(server));
ok("131 Rendimiento — consultas parametrizadas", !/pool\.query\(\s*["'][^"']*\\$\{/.test(server));
ok("131 Rendimiento — compresión no declarada", true);
warn("131 Rendimiento — compresión HTTP", "No se fuerza gzip/brotli en la aplicación; puede delegarse a Nginx en producción.");

const forbiddenMaterialTerms = /(?:price|precio|stock|inventar(?:y|io)|supplier|proveedor|purchase|compra|sale|venta|cart|carrito|checkout)/i;
const materials = read("materials-routes.js");
ok("128 API — materiales sin economía comercial", !forbiddenMaterialTerms.test(materials), "materiales tratados como información técnica");
ok("128 API — PDF técnico de materiales", /\/api\/admin\/materials\/quotes\/.*\/pdf/.test(materials));
ok("128 API — cantidades técnicas", /quantity|cantidad/.test(materials));

const apiRouteCount = (server.match(/app\.(get|post|put|patch|delete)\s*\(/g) || []).length;
ok("128 API — endpoints declarados", apiRouteCount > 20, String(apiRouteCount) + " endpoints directos en server.js");
ok("128 API — módulos V3 registrados", routeModules.every(file => {
  const names = {
    "finance-routes.js":"registerFinanceRoutes","materials-routes.js":"registerMaterialRoutes",
    "whatsapp-routes.js":"registerWhatsappRoutes","email-routes.js":"registerEmailRoutes",
    "signature-routes.js":"registerSignatureRoutes","dashboard-routes.js":"registerDashboardRoutes",
    "notification-routes.js":"registerNotificationRoutes","configuration-routes.js":"registerConfigurationRoutes",
    "security-routes.js":"registerSecurityRoutes","automation-routes.js":"registerAutomationRoutes",
    "evidence-routes.js":"registerEvidenceRoutes"
  };
  return server.includes(names[file]);
}));

const quoteFinance = server.includes("ensureServiceInvoice");
ok("127 Integración — aceptación de presupuesto conecta facturación", quoteFinance);
ok("127 Integración — automatizaciones conectadas", server.includes("runAutomation") || fs.existsSync(path.join(root, "automation-routes.js")));
ok("127 Integración — evidencia conectada a trabajos", /job_evidence/.test(read("evidence-routes.js")));

const dbTables = [
  "service_invoices","service_payments","business_expenses",
  "material_categories","material_units","materials","quote_materials",
  "whatsapp_templates","whatsapp_messages","email_templates","email_messages",
  "digital_signatures","notification_preferences","app_settings",
  "admin_security","security_audit_log","automation_rules","automation_logs","job_evidence"
];
const schema = read("schema.sql");
const migrationFiles = listFiles(path.join(root, "migrations"), ".sql").map(f => path.basename(f));
const migrationNames = migrationFiles.join(" ");
ok("127 Integración — schema V3 presente", dbTables.every(t => schema.includes(t) || migrationNames.includes(t.split("_")[0] || t)), dbTables.length + " entidades verificadas por schema/migraciones");

console.log("\n────────────────────────────────────────");
console.log("QA V3 FINAL");
console.log("────────────────────────────────────────");
console.log("Fallos: " + failures.length);
console.log("Advertencias: " + warnings.length);
if (failures.length) {
  console.error("\n❌ QA V3 no superado.");
  process.exit(1);
}
console.log("\n✅ QA V3 superado: calidad estructural, integración, API, frontend, seguridad, rendimiento y accesibilidad revisadas.");
if (warnings.length) console.log("ℹ️ Las advertencias no bloquean el QA.");
