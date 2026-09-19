const fs=require("fs");
const path=require("path");
const root=path.join(__dirname,"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const checks=[
["ecosystem PM2",fs.existsSync(path.join(root,"ecosystem.config.cjs"))],
["nginx template",fs.existsSync(path.join(root,"deploy","nginx","jr-electricidad.conf"))],
["production validation",read("server.js").includes("function validateProductionConfig")],
["readiness endpoint",read("server.js").includes('app.get("/health/ready"')],
["graceful shutdown",read("server.js").includes("gracefulShutdown")],
["SIGTERM",read("server.js").includes('process.on("SIGTERM"')],
["SIGINT",read("server.js").includes('process.on("SIGINT"')],
["HTTP server handle",read("server.js").includes("httpServer = app.listen")],
["production env example",read(".env.example").includes("BACKUP_RETENTION_DAYS")],
["phase documentation",fs.existsSync(path.join(root,"docs","V2-PHASE-19.md"))]
];
const failed=checks.filter(x=>!x[1]);
checks.forEach(x=>console.log((x[1]?"PASS":"FAIL")+" - "+x[0]));
if(failed.length) process.exit(1);
console.log("\nFase 19: "+checks.length+"/"+checks.length+" comprobaciones estructurales OK.");
