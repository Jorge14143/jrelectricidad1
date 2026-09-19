const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const checks = [
  ["migración de backups", fs.existsSync(path.join(root, "migrations", "013_v2_backups.sql"))],
  ["servicio de backups", fs.existsSync(path.join(root, "lib", "backups.js"))],
  ["script CLI", fs.existsSync(path.join(root, "scripts", "backup-database.js"))],
  ["UI backups", fs.existsSync(path.join(root, "public", "js", "admin-backups.js"))],
  ["sección admin", read("public/admin.html").includes('id="backupsSection"')],
  ["navegación admin", read("public/js/admin-navigation.js").includes('"backupsSection"')],
  ["estilos backups", read("public/css/admin.css").includes("FASE 18 — BACKUPS")],
  ["endpoint listado", read("server.js").includes('app.get("/api/admin/backups"')],
  ["endpoint creación", read("server.js").includes('app.post("/api/admin/backups"')],
  ["endpoint descarga", read("server.js").includes('app.get("/api/admin/backups/:id/download"')],
  ["endpoint eliminación", read("server.js").includes('app.delete("/api/admin/backups/:id"')],
  ["endpoint limpieza", read("server.js").includes('app.post("/api/admin/backups/cleanup"')],
  ["mysqldump seguro por spawn", read("lib/backups.js").includes("spawn(executable")],
  ["MYSQL_PWD", read("lib/backups.js").includes("MYSQL_PWD")],
  ["SHA-256", read("lib/backups.js").includes('createHash("sha256")'),
  ["directorio fuera de public", read("lib/backups.js").includes('storage", "backups')],
  ["scripts package", read("package.json").includes('"backup:v2"') && read("package.json").includes('"test:v2-backups"')]
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log((ok ? "PASS" : "FAIL") + " - " + name);
if (failed.length) process.exit(1);
console.log(`\nFase 18: ${checks.length - failed.length}/${checks.length} comprobaciones estructurales OK.`);
