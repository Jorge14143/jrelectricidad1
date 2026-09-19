"use strict";

const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
const icons = ["⚡","🔧","🧰","💡","🏠","🛠️"];
const categories = {instalaciones:"Instalaciones",reparaciones:"Reparaciones",tableros:"Tableros eléctricos",iluminacion:"Iluminación",mantenimiento:"Mantenimiento",otros:"Otros"};

function setupNav(){
  const toggle=$("navToggle"), nav=$("mainNav");
  toggle?.addEventListener("click",()=>{const open=nav.classList.toggle("open");toggle.setAttribute("aria-expanded",String(open));});
  nav?.querySelectorAll("a").forEach(a=>a.addEventListener("click",()=>nav.classList.remove("open")));
}

function setBusiness(settings){
  if(!settings)return;
  const phone=String(settings.phone||"").trim(), wa=String(settings.whatsapp||phone).replace(/\D/g,""), email=String(settings.email||"").trim(), city=String(settings.city||"Laboulaye y zona").trim();
  document.querySelectorAll("[data-whatsapp-link]").forEach(a=>{if(wa)a.href="https://wa.me/"+wa;});
  document.querySelectorAll("[data-phone-link]").forEach(a=>{if(phone)a.href="tel:"+phone.replace(/\D/g,"");});
  document.querySelectorAll("[data-phone-text]").forEach(el=>el.textContent=phone||"Consultar");
  document.querySelectorAll("[data-email-link]").forEach(a=>{if(email)a.href="mailto:"+email;});
  document.querySelectorAll("[data-email-text]").forEach(el=>el.textContent=email||"Consultar");
  document.querySelectorAll("[data-city-text]").forEach(el=>el.textContent=city);
  const schema=$("business-schema");
  if(schema){try{const data=JSON.parse(schema.textContent);data.name=settings.business_name||data.name;data.telephone=phone?"+54 "+phone.replace(/\D/g,""):"";data.email=email;data.address=settings.address||"";schema.textContent=JSON.stringify(data);}catch{}}
}

function renderServices(services){
  const box=$("v3Services"), select=$("v3ServiceSelect");
  if(!box)return;
  if(!services.length){box.innerHTML='<div class="v3-empty">No hay servicios publicados en este momento.</div>';return;}
  box.innerHTML=services.map((s,i)=>{
    const price=s.price!==null&&s.price!==undefined?("$ "+Number(s.price).toLocaleString("es-AR")):"Consultar";
    const wa=encodeURIComponent("Hola Jorge, quisiera consultar por el servicio: "+s.title);
    return '<article class="v3-service"><div class="v3-service-icon">'+icons[i%icons.length]+'</div><h3>'+esc(s.title)+'</h3><p>'+esc(s.description||"Servicio eléctrico profesional.")+'</p><div class="v3-service-foot"><span class="v3-service-price">'+esc(price)+'</span><a href="https://wa.me/543385684660?text='+wa+'" target="_blank" rel="noopener">Consultar →</a></div></article>';
  }).join("");
  if(select)select.innerHTML='<option value="">Seleccionar</option>'+services.map(s=>'<option value="'+esc(s.title)+'">'+esc(s.title)+'</option>').join("");
}

function renderGallery(items){
  const box=$("v3Gallery"), filters=$("v3GalleryFilters");
  if(!box)return;
  const render=(list)=>{
    if(!list.length){box.innerHTML='<div class="v3-empty">No hay trabajos publicados en esta categoría.</div>';return;}
    box.innerHTML=list.map((w,i)=>'<article class="v3-gallery-item" tabindex="0" data-gallery-index="'+i+'"><img src="'+esc(w.image_url)+'" alt="'+esc(w.alt_text||w.title||"Trabajo realizado")+'" loading="lazy" decoding="async"><div class="v3-gallery-info"><small>'+esc(categories[w.category]||"Trabajo realizado")+(w.featured?" · ⭐ DESTACADO":"")+'</small><h3>'+esc(w.title)+'</h3>'+(w.description?'<p>'+esc(w.description)+'</p>':"")+'</div></article>').join("");
    box.querySelectorAll(".v3-gallery-item").forEach((el,index)=>{el.addEventListener("click",()=>openLightbox(list[index]));el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openLightbox(list[index]);}});});
  };
  if(filters){
    filters.innerHTML='<button class="v3-filter active" data-cat="">Todos</button>'+Object.entries(categories).map(([k,v])=>'<button class="v3-filter" data-cat="'+k+'">'+v+'</button>').join("");
    filters.onclick=e=>{const b=e.target.closest(".v3-filter");if(!b)return;filters.querySelectorAll(".v3-filter").forEach(x=>x.classList.remove("active"));b.classList.add("active");render(b.dataset.cat?items.filter(x=>x.category===b.dataset.cat):items);};
  }
  render(items);
}

function renderTestimonials(items){
  const box=$("v3Testimonials");if(!box)return;
  if(!items.length){box.innerHTML='<div class="v3-empty">Todavía no hay testimonios publicados. Las reseñas se muestran únicamente después de ser verificadas y aprobadas.</div>';return;}
  box.innerHTML=items.map(t=>'<article class="v3-testimonial"><div class="v3-stars" aria-label="'+Number(t.rating||5)+' de 5 estrellas">'+("★".repeat(Math.min(5,Math.max(1,Number(t.rating)||5))))+'</div><p>“'+esc(t.message)+'”</p><strong>'+esc(t.client_name)+'</strong><small>'+esc(t.client_location||"Cliente de JR Electricidad")+'</small></article>').join("");
}

function setStats(stats){for(const [id,key] of [["statServices","services"],["statWorks","works"],["statClients","clients"],["statJobs","completedJobs"]]){const el=$(id);if(el)el.textContent=Number(stats?.[key]||0).toLocaleString("es-AR");}}

async function loadHome(){
  try{
    const r=await fetch("/api/v3/public/home",{headers:{Accept:"application/json"}});
    if(!r.ok)throw new Error();
    const data=await r.json();setBusiness(data.settings);renderServices(data.services||[]);renderGallery(data.gallery||[]);renderTestimonials(data.testimonials||[]);setStats(data.stats||{});
  }catch(error){console.error("V3 public:",error);$("v3Services")&&( $("v3Services").innerHTML='<div class="v3-empty">No se pudo cargar el contenido. Recargá la página.</div>');}
}

function openLightbox(work){
  let box=document.querySelector(".v3-lightbox");
  if(!box){box=document.createElement("div");box.className="v3-lightbox";box.innerHTML='<button type="button" aria-label="Cerrar">×</button><img alt="">';document.body.appendChild(box);box.addEventListener("click",e=>{if(e.target===box||e.target.tagName==="BUTTON")box.classList.remove("open");});}
  const img=box.querySelector("img");img.src=work.image_url||"";img.alt=work.alt_text||work.title||"Trabajo realizado";box.classList.add("open");
}

function setupQuote(){
  const form=$("v3QuoteForm"),msg=$("v3QuoteMessage");if(!form)return;
  form.addEventListener("submit",async e=>{e.preventDefault();msg.className="v3-message";msg.textContent="Enviando…";const button=form.querySelector("button");button.disabled=true;
    try{const r=await fetch("/api/quote-requests",{method:"POST",body:new FormData(form)});const data=await r.json();if(!r.ok)throw new Error(data.error||"No se pudo enviar la solicitud.");msg.className="v3-message success";msg.textContent="✅ Solicitud enviada correctamente. Te contactaremos a la brevedad.";form.reset();}
    catch(error){msg.className="v3-message error";msg.textContent="❌ "+error.message;}finally{button.disabled=false;}
  });
}

async function loadSlots(date){
  const select=$("appointmentTime");if(!select)return;select.innerHTML='<option value="">Consultando horarios…</option>';
  if(!date){select.innerHTML='<option value="">Elegí una fecha primero</option>';return;}
  try{const r=await fetch("/api/v3/public/availability?date="+encodeURIComponent(date));const data=await r.json();if(!r.ok)throw new Error(data.error||"No se pudo consultar.");select.innerHTML=data.slots?.length?'<option value="">Seleccionar horario</option>'+data.slots.map(s=>'<option value="'+s+'">'+s+' hs</option>').join(""):'<option value="">No hay horarios disponibles</option>';}
  catch(error){select.innerHTML='<option value="">No se pudo consultar</option>';}
}

function setupAppointment(){
  const form=$("v3AppointmentForm"),date=$("appointmentDate"),msg=$("v3AppointmentMessage");if(!form)return;
  const today=new Date();today.setMinutes(today.getMinutes()-today.getTimezoneOffset());date.min=today.toISOString().slice(0,10);date.addEventListener("change",()=>loadSlots(date.value));
  form.addEventListener("submit",async e=>{e.preventDefault();msg.className="v3-message";msg.textContent="Enviando…";const button=form.querySelector("button");button.disabled=true;
    try{const body=Object.fromEntries(new FormData(form));const r=await fetch("/api/v3/public/appointments",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error||"No se pudo registrar.");msg.className="v3-message success";msg.textContent="✅ "+data.message;form.reset();$("appointmentTime").innerHTML='<option value="">Elegí una fecha primero</option>';}
    catch(error){msg.className="v3-message error";msg.textContent="❌ "+error.message;}finally{button.disabled=false;}
  });
}

function registerPwa(){if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));}

setupNav();setupQuote();setupAppointment();loadHome();registerPwa();