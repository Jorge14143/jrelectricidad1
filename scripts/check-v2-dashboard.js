"use strict";

const fs=require("fs");
const path=require("path");
const root=path.join(__dirname,"..");

const files=[
  "server.js",
  "public/admin.html",
  "public/js/admin-dashboard.js",
  "public/css/admin.css"
];

for(const file of files){
  if(!fs.existsSync(path.join(root,file))) throw new Error("Falta archivo: "+file);
}

const server=fs.readFileSync(path.join(root,"server.js"),"utf8");
const html=fs.readFileSync(path.join(root,"public/admin.html"),"utf8");
const js=fs.readFileSync(path.join(root,"public/js/admin-dashboard.js"),"utf8");
const css=fs.readFileSync(path.join(root,"public/css/admin.css"),"utf8");

const checks=[
 ["endpoint de estadísticas",server.includes('"/api/admin/stats"')],
 ["filtro de período",server.includes("daysRaw")&&server.includes("periodQuotes")],
 ["clientes nuevos",server.includes("newClients")],
 ["galería dashboard",server.includes("gallerySummary")&&server.includes("published")],
 ["pipeline solicitudes",server.includes("requestPipeline")],
 ["agenda próximos trabajos",server.includes("upcomingJobs")],
 ["servicios más solicitados",server.includes("topServices")],
 ["estados de trabajos",server.includes("jobStatusSummary")],
 ["selector de período",html.includes('id="dashboardPeriod"')],
 ["pipeline UI",html.includes('id="dashboardRequestPipeline"')],
 ["agenda UI",html.includes('id="dashboardUpcomingJobs"')],
 ["servicios UI",html.includes('id="dashboardTopServices"')],
 ["estados UI",html.includes('id="dashboardJobStatuses"')],
 ["clientes nuevos KPI",html.includes('id="dashNewClients"')],
 ["conversión KPI",html.includes('id="dashConversion"')],
 ["render pipeline",js.includes("requestPipeline")],
 ["render agenda",js.includes("upcomingJobs")],
 ["render servicios",js.includes("topServices")],
 ["render estados",js.includes("jobStatusSummary")],
 ["responsive dashboard",css.includes(".dashboard-pipeline")&&css.includes("@media(max-width:800px)")]
];

let failed=false;
for(const [name,ok] of checks){
 console.log((ok?"✅":"❌")+" "+name);
 if(!ok)failed=true;
}
if(failed)process.exitCode=1;
else console.log("Fase 10 Dashboard: validación estática OK.");
