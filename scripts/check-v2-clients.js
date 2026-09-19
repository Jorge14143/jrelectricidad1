"use strict";
const fs=require("fs");
function read(p){return fs.readFileSync(p,"utf8");}
function assert(v,m){if(!v)throw new Error("FAIL: "+m);console.log("PASS:",m);}
const server=read("server.js");
const migration=read("migrations/004_clients.sql");
const html=read("public/admin.html");
const js=read("public/js/clients.js");
new Function(server); new Function(js);
assert(migration.includes("CREATE TABLE IF NOT EXISTS clients"),"clients table");
assert(migration.includes("client_id"),"quote request client relation");
assert(migration.includes("INSERT INTO clients"),"legacy client backfill");
for(const p of ["/api/admin/clients","/api/admin/clients/:id","/api/admin/clients/:id/history"]) assert(server.includes(p.replace(":id","")), "client API marker "+p);
assert(server.includes('app.post("/api/admin/clients"'),"create client endpoint");
assert(server.includes('app.put("/api/admin/clients/:id'),"update client endpoint");
assert(server.includes('app.delete("/api/admin/clients/:id'),"delete client endpoint");
assert(server.includes('app.get("/api/admin/clients/:id(\\d+)/history'),"client history endpoint");
assert(server.includes("clientId"),"public request auto-link");
assert(html.includes('id="newClientButton"'),"new client button");
assert(html.includes('/js/clients.js'),"client frontend loaded");
assert(js.includes("/api/admin/clients"),"client frontend API");
assert(js.includes("/history"),"client history UI");
console.log("V2 CLIENTS CHECK: OK");
