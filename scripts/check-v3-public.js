const fs=require("fs"),path=require("path");
const root=path.join(__dirname,"..");
const required=[
"public/index.html","public/css/v3-public.css","public/js/v3-public.js",
"public/manifest.webmanifest","public/sw.js","public/robots.txt","public/sitemap.xml",
"migrations/017_v3_public.sql","docs/V3-BLOCK-B.md","lib/v3.js"
];
const missing=required.filter(file=>!fs.existsSync(path.join(root,file)));
if(missing.length){console.error("❌ Faltan:",missing.join(", "));process.exit(1);}
const index=fs.readFileSync(path.join(root,"public/index.html"),"utf8");
const frontend=fs.readFileSync(path.join(root,"public/js/v3-public.js"),"utf8");
const api=fs.readFileSync(path.join(root,"lib/v3.js"),"utf8");
const migration=fs.readFileSync(path.join(root,"migrations/017_v3_public.sql"),"utf8");
const checks=[
["Home V3",/v3-hero/.test(index)],
["Servicios V3",/v3Services/.test(index)&&/public\/home/.test(api)],
["Galería V3",/v3Gallery/.test(index)],
["Testimonios V3",/v3Testimonials/.test(index)&&/v3_testimonials/.test(migration)],
["Presupuesto",/v3QuoteForm/.test(index)&&/api\/quote-requests/.test(index)],
["Agenda",/v3AppointmentForm/.test(index)&&/public\/appointments/.test(api)&&/v3_appointments/.test(migration)],
["SEO",/application\/ld\+json/.test(index)&&/canonical/.test(index)],
["Contacto",/v3-contact/.test(index)],
["PWA",/manifest.webmanifest/.test(index)&&fs.existsSync(path.join(root,"public/sw.js"))]
];
for(const [name,ok] of checks)console.log((ok?"✅ ":"❌ ")+name);
const failed=checks.filter(([,ok])=>!ok);
if(failed.length)process.exit(1);
console.log("✅ Bloque B — Página pública V3: 100% estructurado.");