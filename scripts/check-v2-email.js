"use strict";

const fs=require("fs");
const path=require("path");

function read(name){return fs.readFileSync(path.join(__dirname,"..",name),"utf8");}
function assert(ok,msg){if(!ok) throw new Error("V2 EMAIL: "+msg);}

const server=read("server.js");
const pkg=JSON.parse(read("package.json"));
const migration=read("migrations/011_email.sql");
const service=read("lib/email.js");

assert(/email_outbox/.test(migration),"falta email_outbox");
assert(/status ENUM\('queued','sending','sent','failed','skipped'\)/.test(migration),"faltan estados de entrega");
assert(/attempts/.test(migration)&&/next_attempt_at/.test(migration),"falta reintento");
assert(/provider_message_id/.test(migration),"falta ID del proveedor");
assert(/configureEmailService/.test(server),"servicio central no inicializado");
assert(/queueEmail/.test(server),"server no usa cola de email");
assert(/\/api\/admin\/email\/status/.test(server),"falta estado administrativo del email");
assert(/\/api\/admin\/email\/outbox/.test(server),"falta consulta de outbox");
for(const template of ["password_reset","generic_account","quote_sent","quote_decision"]){
  assert(service.includes('case "'+template+'"'),"falta template "+template);
}
assert(/setInterval/.test(service),"falta procesamiento periódico");
assert(/createTransporter/.test(service),"falta abstracción SMTP");
assert(/sendMail/.test(service),"falta entrega SMTP");
assert(/next_attempt_at/.test(service)&&/max_attempts/.test(service),"falta política de reintentos");
assert(pkg.scripts["test:v2-email"],"falta script test:v2-email");
console.log("V2 EMAIL: 100% OK");
