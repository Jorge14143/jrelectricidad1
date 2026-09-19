"use strict";

const GALLERY_PUBLIC_CATEGORIES={instalaciones:"Instalaciones",reparaciones:"Reparaciones",tableros:"Tableros eléctricos",iluminacion:"Iluminación",mantenimiento:"Mantenimiento",otros:"Otros"};
let publicGalleryWorks=[];
function galleryPublicEscape(value){return String(value??"").replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c];});}

async function loadGallery(category=""){
 const gallery=document.getElementById("gallery"); if(!gallery)return;
 try{
  const params=new URLSearchParams(); if(category)params.set("category",category);
  const response=await fetch("/api/gallery?"+params.toString(),{headers:{Accept:"application/json"}});
  if(!response.ok)throw new Error("No se pudo cargar la galería.");
  const works=await response.json(); publicGalleryWorks=Array.isArray(works)?works:[];
  if(!publicGalleryWorks.length){gallery.innerHTML='<div class="gallery-empty"><span>⚡</span><p>No hay trabajos publicados en esta categoría.</p></div>';return;}
  gallery.innerHTML=publicGalleryWorks.map((work,index)=>
    '<article class="gallery-item" tabindex="0" role="button" data-gallery-index="'+index+'" aria-label="Ver trabajo: '+galleryPublicEscape(work.title)+'">'+
    '<img src="'+galleryPublicEscape(work.image_url)+'" alt="'+galleryPublicEscape(work.alt_text||work.title)+'" loading="lazy" decoding="async">'+
    '<div class="gallery-info"><div class="gallery-meta"><span class="gallery-category-label">'+galleryPublicEscape(GALLERY_PUBLIC_CATEGORIES[work.category]||"Otros")+'</span>'+
    (work.featured?'<span class="gallery-featured-label">⭐ DESTACADO</span>':"")+'</div><h3>'+galleryPublicEscape(work.title)+'</h3>'+
    (work.description?'<p>'+galleryPublicEscape(work.description)+'</p>':"")+'</div></article>'
  ).join("");
 }catch(error){console.error("Error cargando galería:",error);gallery.innerHTML='<div class="gallery-empty"><span>⚠️</span><p>No se pudieron cargar los trabajos.</p></div>';}
}

function ensureGalleryFilters(){
 const section=document.getElementById("trabajos"),gallery=document.getElementById("gallery");
 if(!section||!gallery||document.getElementById("galleryPublicFilters"))return;
 const wrap=document.createElement("div"); wrap.id="galleryPublicFilters";wrap.className="gallery-public-filters";wrap.setAttribute("role","group");wrap.setAttribute("aria-label","Filtrar trabajos");
 wrap.innerHTML='<button type="button" class="gallery-filter active" data-category="">Todos</button>'+Object.entries(GALLERY_PUBLIC_CATEGORIES).map(([value,label])=>'<button type="button" class="gallery-filter" data-category="'+value+'">'+label+'</button>').join("");
 gallery.parentNode.insertBefore(wrap,gallery);
 wrap.addEventListener("click",event=>{const button=event.target.closest(".gallery-filter");if(!button)return;wrap.querySelectorAll(".gallery-filter").forEach(x=>x.classList.remove("active"));button.classList.add("active");loadGallery(button.dataset.category||"");});
}

const lightbox=document.getElementById("lightbox"),lightboxImage=document.getElementById("lightboxImage"),lightboxTitle=document.getElementById("lightboxTitle"),lightboxDescription=document.getElementById("lightboxDescription"),lightboxClose=document.getElementById("lightboxClose");
function openLightbox(work){if(!lightbox||!lightboxImage)return;lightboxImage.src=work.image_url||"";lightboxImage.alt=work.alt_text||work.title||"Trabajo realizado";if(lightboxTitle)lightboxTitle.textContent=work.title||"";if(lightboxDescription)lightboxDescription.textContent=work.description||"";lightbox.classList.add("active");lightbox.setAttribute("aria-hidden","false");document.body.classList.add("lightbox-open");lightboxClose?.focus();}
function closeLightbox(){if(!lightbox)return;lightbox.classList.remove("active");lightbox.setAttribute("aria-hidden","true");document.body.classList.remove("lightbox-open");if(lightboxImage)lightboxImage.src="";}
lightboxClose?.addEventListener("click",closeLightbox);lightbox?.addEventListener("click",event=>{if(event.target===lightbox)closeLightbox();});document.addEventListener("keydown",event=>{if(event.key==="Escape")closeLightbox();});
document.addEventListener("click",event=>{const item=event.target.closest(".gallery-item");if(!item)return;const work=publicGalleryWorks[Number(item.dataset.galleryIndex)];if(work)openLightbox(work);});
document.addEventListener("keydown",event=>{if(!["Enter"," "].includes(event.key))return;const item=event.target.closest(".gallery-item");if(!item)return;event.preventDefault();item.click();});
ensureGalleryFilters();loadGallery();