"use strict";

const fs=require("fs");
const path=require("path");
const root=path.join(__dirname,"..");

const files=[
  "server.js",
  "migrations/010_notifications.sql",
  "public/admin.html",
  "public/js/admin-notifications.js",
  "public/css/admin.css"
];

for(const file of files){
  if(!fs.existsSync(path.join(root,file))) throw new Error("Falta archivo: "+file);
}

const server=fs.readFileSync(path.join(root,"server.js"),"utf8");
const migration=fs.readFileSync(path.join(root,"migrations/010_notifications.sql"),"utf8");
const html=fs.readFileSync(path.join(root,"public/admin.html"),"utf8");
const js=fs.readFileSync(path.join(root,"public/js/admin-notifications.js"),"utf8");
const css=fs.readFileSync(path.join(root,"public/css/admin.css"),"utf8");

const checks=[
 ["migración 010",migration.includes("admin_notifications")&&migration.includes("user_id")&&migration.includes("priority")&&migration.includes("archived_at")],
 ["tipos avanzados",migration.includes("quote_sent")&&migration.includes("job_assigned")&&migration.includes("job_scheduled")&&migration.includes("job_finished")],
 ["helper central",server.includes("async function createAdminNotification")],
 ["endpoint listado",server.includes('"/api/admin/notifications"')],
 ["marcar una",server.includes('"/api/admin/notifications/:id/read"')],
 ["marcar todas",server.includes('"/api/admin/notifications/read-all"')],
 ["archivar una",server.includes('"/api/admin/notifications/:id/archive"')],
 ["archivar todas",server.includes('"/api/admin/notifications/archive-all"')],
 ["destinatario",server.includes("user_id IS NULL OR user_id=?")],
 ["prioridad",server.includes("priority")],
 ["enlace entidad",server.includes("entity_type")&&server.includes("link_url")],
 ["badge superior",html.includes('id="notificationsBadge"')],
 ["badge lateral",html.includes('id="sidebarNotificationsBadge"')],
 ["panel",html.includes('id="notificationsPanel"')],
 ["marcar todas UI",html.includes('id="markAllNotificationsRead"')],
 ["polling",js.includes("setInterval")&&js.includes("loadNotifications")],
 ["click enlace",js.includes("notification.link_url")],
 ["archivado UI",js.includes("archiveNotification")],
 ["estilos prioridad",css.includes(".notification-priority")],
 ["responsive",css.includes(".notifications-panel")]
];

let failed=false;
for(const [name,ok] of checks){
 console.log((ok?"✅":"❌")+" "+name);
 if(!ok)failed=true;
}
if(failed)process.exitCode=1;
else console.log("Fase 11 Notificaciones: validación estática OK.");
