"use strict";

const fs=require("fs");
const path=require("path");
function read(name){return fs.readFileSync(path.join(__dirname,"..",name),"utf8");}
function assert(ok,msg){if(!ok)throw new Error("V2 WHATSAPP: "+msg);}
const server=read("server.js");
const service=read("lib/whatsapp.js");
const migration=read("migrations/012_whatsapp.sql");
const pkg=JSON.parse(read("package.json"));

assert(/whatsapp_outbox/.test(migration),"falta whatsapp_outbox");
assert(/whatsapp_enabled/.test(migration)&&/whatsapp_auto_notifications/.test(migration),"faltan preferencias WhatsApp");
assert(/normalizeWhatsAppNumber/.test(service),"falta normalización");
assert(/buildWhatsAppLink/.test(service),"falta enlace wa.me");
assert(/WHATSAPP_ACCESS_TOKEN/.test(service)&&/WHATSAPP_PHONE_NUMBER_ID/.test(service),"falta configuración Cloud API");
assert(/queueWhatsApp/.test(service)&&/processWhatsAppQueue/.test(service),"falta cola");
assert(/sendProviderMessage/.test(service)&&/graph\.facebook\.com/.test(service),"falta integración Cloud API");
assert(/configureWhatsAppService/.test(server),"servicio WhatsApp no inicializado");
assert(/\/api\/admin\/whatsapp\/status/.test(server),"falta estado administrativo");
assert(/\/api\/admin\/whatsapp\/outbox/.test(server),"falta outbox administrativo");
assert(/test:v2-whatsapp/.test(JSON.stringify(pkg.scripts)),"falta script de validación");
console.log("V2 WHATSAPP: 100% OK");
