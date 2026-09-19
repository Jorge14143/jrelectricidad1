const fs = require("fs");
const path = require("path");

const migration = fs.readFileSync(path.join(__dirname,"..","migrations","008_jobs_advanced.sql"),"utf8");
const server = fs.readFileSync(path.join(__dirname,"..","server.js"),"utf8");
const js = fs.readFileSync(path.join(__dirname,"..","public","js","admin-jobs.js"),"utf8");

const required = [
  "assigned_user_id","scheduled_at","internal_notes","execution_notes",
  "completion_notes","job_history","job_attachments",
  "/api/admin/jobs","/api/admin/jobs/:id(\\d+)/status",
  "/api/admin/jobs/:id(\\d+)/history","/api/admin/jobs/:id(\\d+)/attachments"
];

for (const item of required) {
  if (!migration.includes(item) && !server.includes(item)) {
    throw new Error("Falta componente: " + item);
  }
}

for (const item of ["programado","en_proceso","pausado","finalizado","cerrado"]) {
  if (!server.includes(item) || !js.includes(item)) throw new Error("Falta estado: "+item);
}

console.log("V2 Fase 8 — Trabajos: OK");
