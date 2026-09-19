"use strict";

const fs=require("fs");
const path=require("path");

const root=path.join(__dirname,"..");
const required=[
  "server.js",
  "migrations/009_gallery.sql",
  "public/js/admin-gallery.js",
  "public/js/gallery.js",
  "public/js/admin-jobs.js",
  "public/css/gallery.css",
  "public/css/admin.css",
  "public/admin.html"
];

for(const file of required){
  const full=path.join(root,file);
  if(!fs.existsSync(full)) throw new Error("Falta archivo: "+file);
}

const server=fs.readFileSync(path.join(root,"server.js"),"utf8");
const migration=fs.readFileSync(path.join(root,"migrations/009_gallery.sql"),"utf8");
const adminGallery=fs.readFileSync(path.join(root,"public/js/admin-gallery.js"),"utf8");
const publicGallery=fs.readFileSync(path.join(root,"public/js/gallery.js"),"utf8");
const adminJobs=fs.readFileSync(path.join(root,"public/js/admin-jobs.js"),"utf8");
const html=fs.readFileSync(path.join(root,"public/admin.html"),"utf8");

const checks=[
  ["server public gallery",server.includes('"/api/gallery"')],
  ["server admin gallery",server.includes('"/api/admin/gallery"')],
  ["gallery categories",server.includes("GALLERY_CATEGORIES")],
  ["gallery relations",server.includes("validateGalleryRelations")],
  ["gallery promotion",server.includes("/api/admin/gallery/from-job-attachment/")],
  ["gallery order",server.includes("/api/admin/gallery/:id(\\d+)/order")],
  ["gallery migration fields",migration.includes("source_job_attachment_id")&&migration.includes("category")],
  ["admin gallery CRUD",adminGallery.includes("saveGallery")&&adminGallery.includes("deleteGallery")],
  ["admin gallery filters",adminGallery.includes("galleryCategoryFilter")],
  ["public gallery filters",publicGallery.includes("gallery-public-filters")],
  ["job promotion button",adminJobs.includes("promoteJobAttachment")],
  ["gallery form category",html.includes('id="galleryCategory"')],
  ["gallery relation selectors",html.includes('id="galleryJob"')&&html.includes('id="galleryClient"')]
];

for(const [name,ok] of checks){
  console.log((ok?"✅":"❌")+" "+name);
  if(!ok)process.exitCode=1;
}

console.log(process.exitCode?"Fase 9: hay validaciones pendientes.":"Fase 9 Galería: validación estática OK.");
