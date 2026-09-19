"use strict";

let adminGalleryData = [];
let galleryClients = [];
let galleryJobs = [];
let galleryQuotes = [];

const GALLERY_CATEGORY_LABELS = {
  instalaciones:"Instalaciones",
  reparaciones:"Reparaciones",
  tableros:"Tableros eléctricos",
  iluminacion:"Iluminación",
  mantenimiento:"Mantenimiento",
  otros:"Otros"
};

function galleryEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

async function loadGallery() {
  const container=$( "adminGallery" );
  if(!container) return;
  try {
    const params=new URLSearchParams();
    const search=$( "gallerySearch" )?.value.trim();
    const category=$( "galleryCategoryFilter" )?.value;
    const status=$( "galleryStatusFilter" )?.value;
    if(search) params.set("search",search);
    if(category) params.set("category",category);
    if(status) params.set("status",status);
    adminGalleryData=await api("/api/admin/gallery?"+params.toString());
    renderAdminGallery();
  } catch(error) {
    console.error("Error cargando galería:",error);
    showMsg("No se pudo cargar la galería: "+error.message,true);
  }
}

function fillGalleryRelations() {
  const clientSelect=$( "galleryClient" );
  const jobSelect=$( "galleryJob" );
  const quoteSelect=$( "galleryQuote" );

  if(clientSelect) {
    clientSelect.innerHTML='<option value="">Sin cliente vinculado</option>'+
      galleryClients.map(c=>'<option value="'+Number(c.id)+'">'+galleryEscape(c.name)+' · '+galleryEscape(c.phone)+'</option>').join("");
  }
  if(jobSelect) {
    jobSelect.innerHTML='<option value="">Sin trabajo vinculado</option>'+
      galleryJobs.map(j=>'<option value="'+Number(j.id)+'">#'+Number(j.id)+' · '+galleryEscape(j.client_name||"Sin cliente")+' · '+galleryEscape(j.quote_number||"")+' · '+galleryEscape(j.status)+'</option>').join("");
  }
  if(quoteSelect) {
    quoteSelect.innerHTML='<option value="">Sin presupuesto vinculado</option>'+
      galleryQuotes.map(q=>'<option value="'+Number(q.id)+'">'+galleryEscape(q.quote_number||("#"+q.id))+' · '+galleryEscape(q.client_name||"Sin cliente")+'</option>').join("");
  }
}

async function loadGalleryRelations() {
  try {
    const clientsData=await api("/api/admin/clients");
    galleryClients=clientsData.clients||[];
  } catch(error) {
    galleryClients=[];
    console.warn("No se pudieron cargar clientes para galería:",error);
  }

  try {
    const [finalized,closed]=await Promise.all([
      api("/api/admin/jobs?status=finalizado"),
      api("/api/admin/jobs?status=cerrado")
    ]);
    const map=new Map();
    [...(finalized.jobs||[]),...(closed.jobs||[])].forEach(j=>map.set(Number(j.id),j));
    galleryJobs=[...map.values()];
  } catch(error) {
    galleryJobs=[];
    console.warn("No se pudieron cargar trabajos para galería:",error);
  }

  try {
    const quotesData=await api("/api/admin/quotes");
    galleryQuotes=quotesData.quotes||quotesData||[];
  } catch(error) {
    galleryQuotes=[];
    console.warn("No se pudieron cargar presupuestos para galería:",error);
  }

  fillGalleryRelations();
}

function renderAdminGallery() {
  const container=$( "adminGallery" );
  if(!container) return;
  if(!adminGalleryData.length) {
    container.innerHTML='<p class="muted gallery-empty">No hay trabajos que coincidan con los filtros.</p>';
    return;
  }

  container.innerHTML=adminGalleryData.map(item=>{
    const active=Number(item.active)===1;
    const featured=Number(item.featured)===1;
    const category=GALLERY_CATEGORY_LABELS[item.category]||"Otros";
    const relation=[
      item.client_name ? "👤 "+galleryEscape(item.client_name) : "",
      item.job_id ? "🔧 Trabajo #"+Number(item.job_id) : "",
      item.quote_number ? "📄 "+galleryEscape(item.quote_number) : ""
    ].filter(Boolean).join(" · ");

    return '<article class="gallery-admin-item '+(active?"":"inactive")+'">'+
      '<div class="gallery-admin-image"><img src="'+galleryEscape(item.image_url)+'" alt="'+galleryEscape(item.alt_text||item.title)+'" loading="lazy"></div>'+
      '<div class="gallery-admin-info">'+
      '<div class="gallery-admin-title"><h3>'+galleryEscape(item.title)+'</h3><span class="status '+(active?"on":"off")+'">'+(active?"Publicado":"Oculto")+'</span></div>'+
      '<div class="gallery-admin-badges"><span>'+galleryEscape(category)+'</span>'+(featured?'<span class="gallery-featured-badge">⭐ Destacado</span>':"")+'</div>'+
      '<p>'+galleryEscape(item.description||"Sin descripción")+'</p>'+
      (relation?'<small class="muted">'+relation+'</small>':"")+
      '<div class="row-actions">'+
      '<button class="btn tiny ghost" type="button" onclick="moveGallery('+Number(item.id)+',\'up\')">⬆️</button>'+
      '<button class="btn tiny ghost" type="button" onclick="moveGallery('+Number(item.id)+',\'down\')">⬇️</button>'+
      '<button class="btn tiny" type="button" onclick="editGallery('+Number(item.id)+')">Editar</button>'+
      '<button class="btn tiny ghost" type="button" onclick="toggleGallery('+Number(item.id)+','+Number(item.active)+')">'+(active?"Ocultar":"Publicar")+'</button>'+
      '<button class="btn tiny danger" type="button" onclick="deleteGallery('+Number(item.id)+')">Eliminar</button>'+
      '</div></div></article>';
  }).join("");
}

async function editGallery(id) {
  try {
    const item=await api("/api/admin/gallery/"+Number(id));
    $( "galleryId" ).value=item.id;
    $( "galleryTitle" ).value=item.title||"";
    $( "galleryDescription" ).value=item.description||"";
    $( "galleryAltText" ).value=item.alt_text||item.title||"";
    $( "galleryCategory" ).value=item.category||"otros";
    $( "galleryActive" ).checked=Number(item.active)===1;
    $( "galleryFeatured" ).checked=Number(item.featured)===1;
    if($( "galleryClient" ))$( "galleryClient" ).value=item.client_id||"";
    if($( "galleryJob" ))$( "galleryJob" ).value=item.job_id||"";
    if($( "galleryQuote" ))$( "galleryQuote" ).value=item.quote_id||"";
    if($( "galleryPreview" ))$( "galleryPreview" ).innerHTML='<div class="gallery-preview-card"><img src="'+galleryEscape(item.image_url)+'" alt="'+galleryEscape(item.alt_text||item.title)+'"><small class="muted">Imagen actual</small></div>';
    $( "gallerySubmit" ).textContent="💾 Guardar cambios";
    $( "galleryCancel" ).hidden=false;
    document.querySelector(".gallery-admin-panel")?.scrollIntoView({behavior:"smooth",block:"start"});
  } catch(error) {
    showMsg(error.message||"No se pudo cargar el trabajo.",true);
  }
}

function resetGalleryForm() {
  $( "galleryForm" )?.reset();
  $( "galleryId" ).value="";
  $( "galleryCategory" ).value="otros";
  $( "galleryActive" ).checked=true;
  $( "galleryFeatured" ).checked=false;
  $( "gallerySubmit" ).textContent="📸 Agregar trabajo";
  $( "galleryCancel" ).hidden=true;
  if($( "galleryPreview" ))$( "galleryPreview" ).innerHTML="";
}

async function saveGallery(event) {
  event.preventDefault();
  const id=$( "galleryId" ).value.trim();
  const title=$( "galleryTitle" ).value.trim();
  const description=$( "galleryDescription" ).value.trim();
  const altText=$( "galleryAltText" ).value.trim();
  const category=$( "galleryCategory" ).value;
  const imageInput=$( "galleryImage" );
  const clientId=$( "galleryClient" ).value;
  const jobId=$( "galleryJob" ).value;
  const quoteId=$( "galleryQuote" ).value;

  if(!title) return showMsg("El título es obligatorio.",true);
  if(title.length>150) return showMsg("El título no puede superar 150 caracteres.",true);
  if(description.length>500) return showMsg("La descripción no puede superar 500 caracteres.",true);
  if(!altText||altText.length>255) return showMsg("El texto alternativo es obligatorio y no puede superar 255 caracteres.",true);
  if(!id&&(!imageInput.files||!imageInput.files.length)) return showMsg("Debes seleccionar una imagen.",true);
  if(imageInput.files?.[0] && imageInput.files[0].size>5*1024*1024) return showMsg("La imagen no puede superar los 5 MB.",true);

  const form=new FormData();
  form.append("title",title);
  form.append("description",description);
  form.append("alt_text",altText);
  form.append("category",category);
  form.append("active",$( "galleryActive" ).checked?"1":"0");
  form.append("featured",$( "galleryFeatured" ).checked?"1":"0");
  form.append("client_id",clientId);
  form.append("job_id",jobId);
  form.append("quote_id",quoteId);
  if(imageInput.files?.[0])form.append("image",imageInput.files[0]);

  try {
    const result=await api(id?"/api/admin/gallery/"+id:"/api/admin/gallery",{method:id?"PUT":"POST",body:form});
    showMsg(result.message||"Galería actualizada correctamente.");
    resetGalleryForm();
    await loadGallery();
  } catch(error) {
    showMsg(error.message||"No se pudo guardar el trabajo.",true);
  }
}

async function toggleGallery(id,active) {
  const item=adminGalleryData.find(x=>Number(x.id)===Number(id));
  if(!item) return showMsg("Trabajo no encontrado.",true);
  const form=new FormData();
  form.append("title",item.title||"");
  form.append("description",item.description||"");
  form.append("alt_text",item.alt_text||item.title||"");
  form.append("category",item.category||"otros");
  form.append("active",active?"0":"1");
  form.append("featured",item.featured?"1":"0");
  form.append("client_id",item.client_id||"");
  form.append("job_id",item.job_id||"");
  form.append("quote_id",item.quote_id||"");
  try {
    await api("/api/admin/gallery/"+Number(id),{method:"PUT",body:form});
    showMsg(active?"Trabajo ocultado.":"Trabajo publicado.");
    await loadGallery();
  } catch(error) { showMsg(error.message,true); }
}

async function moveGallery(id,direction) {
  try {
    await api("/api/admin/gallery/"+Number(id)+"/order",{
      method:"PUT",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({direction})
    });
    await loadGallery();
  } catch(error) { showMsg(error.message,true); }
}

async function deleteGallery(id) {
  const item=adminGalleryData.find(x=>Number(x.id)===Number(id));
  if(!item||!confirm('¿Eliminar el trabajo "'+(item.title||"")+'" definitivamente?'))return;
  try {
    await api("/api/admin/gallery/"+Number(id),{method:"DELETE"});
    showMsg("Trabajo eliminado correctamente.");
    await loadGallery();
  } catch(error) { showMsg(error.message,true); }
}

async function promoteJobAttachment(attachmentId,jobId) {
  const item=galleryJobs.find(j=>Number(j.id)===Number(jobId));
  const title=prompt("Título para la galería:",item?.requested_service||"Trabajo realizado");
  if(title===null)return;
  const category=prompt("Categoría: instalaciones, reparaciones, tableros, iluminacion, mantenimiento u otros","otros");
  if(category===null)return;
  try {
    await api("/api/admin/gallery/from-job-attachment/"+Number(attachmentId),{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({title,category,active:1})
    });
    showMsg("La evidencia fue publicada en la galería.");
    await loadGallery();
  } catch(error) { showMsg(error.message,true); }
}

function setupGalleryFilters() {
  $( "gallerySearch" )?.addEventListener("input",loadGallery);
  $( "galleryCategoryFilter" )?.addEventListener("change",loadGallery);
  $( "galleryStatusFilter" )?.addEventListener("change",loadGallery);
  $( "clearGalleryFilters" )?.addEventListener("click",()=>{
    if($( "gallerySearch" ))$( "gallerySearch" ).value="";
    if($( "galleryCategoryFilter" ))$( "galleryCategoryFilter" ).value="";
    if($( "galleryStatusFilter" ))$( "galleryStatusFilter" ).value="";
    loadGallery();
  });
  $( "refreshGallery" )?.addEventListener("click",loadGallery);
  $( "galleryCancel" )?.addEventListener("click",resetGalleryForm);
  $( "galleryForm" )?.addEventListener("submit",saveGallery);
  $( "galleryImage" )?.addEventListener("change",()=>{
    const file=$( "galleryImage" ).files?.[0];
    const preview=$( "galleryPreview" );
    if(!preview)return;
    if(!file){preview.innerHTML="";return;}
    if(!file.type.startsWith("image/")||file.size>5*1024*1024){
      preview.innerHTML='<p class="notice error">La imagen debe ser JPG, PNG, WEBP o GIF y no superar 5 MB.</p>';
      $( "galleryImage" ).value="";
      return;
    }
    const url=URL.createObjectURL(file);
    preview.innerHTML='<div class="gallery-preview-card"><img src="'+url+'" alt="Vista previa"></div>';
  });
  loadGalleryRelations();
  loadGallery();
}
