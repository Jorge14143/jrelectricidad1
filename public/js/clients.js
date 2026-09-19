"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
  const money = v => new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(Number(v||0));

  async function api(url, options={}) {
    const r = await fetch(url,{credentials:"include",...options,headers:{
      ...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})
    }});
    let data={}; try{data=await r.json();}catch{}
    if(!r.ok) throw new Error(data.error||"No se pudo completar la operación.");
    return data;
  }

  function openEditor(client={}) {
    const modal=document.createElement("div");
    modal.className="modal";
    modal.style.display="flex";
    modal.innerHTML=`
      <div class="modal-content" style="max-width:760px">
        <div class="modal-header">
          <div><span class="section-label">CLIENTE</span><h2>${client.id?"Editar cliente":"Nuevo cliente"}</h2></div>
          <button type="button" class="modal-close">×</button>
        </div>
        <form id="clientEditorForm" class="form-grid">
          <label>Nombre<input name="name" maxlength="150" required value="${esc(client.name)}"></label>
          <label>Teléfono<input name="phone" maxlength="50" required value="${esc(client.phone)}"></label>
          <label>WhatsApp<input name="whatsapp" maxlength="50" value="${esc(client.whatsapp)}"></label>
          <label>Email<input name="email" type="email" maxlength="190" value="${esc(client.email)}"></label>
          <label>Dirección<input name="address" maxlength="255" value="${esc(client.address)}"></label>
          <label>Localidad<input name="locality" maxlength="120" value="${esc(client.locality)}"></label>
          <label style="grid-column:1/-1">Notas<textarea name="notes" maxlength="5000" rows="5">${esc(client.notes)}</textarea></label>
          <div class="form-actions" style="grid-column:1/-1">
            <button type="button" class="btn ghost" data-close>Cancelar</button>
            <button type="submit" class="btn">💾 Guardar cliente</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);
    const close=()=>modal.remove();
    modal.querySelector(".modal-close").onclick=close;
    modal.querySelector("[data-close]").onclick=close;
    modal.addEventListener("click",e=>{if(e.target===modal)close();});
    modal.querySelector("form").onsubmit=async e=>{
      e.preventDefault();
      const form=e.currentTarget, button=form.querySelector("button[type=submit]");
      const data=Object.fromEntries(new FormData(form).entries());
      button.disabled=true;
      try{
        const result=await api(client.id?"/api/admin/clients/"+client.id:"/api/admin/clients",{
          method:client.id?"PUT":"POST",body:JSON.stringify(data)
        });
        close(); await loadClients(); window.adminClientsNotice?.(result.message||"Cliente guardado.");
      }catch(err){ alert(err.message); button.disabled=false; }
    };
  }

  function openHistory(id) {
    const modal=document.createElement("div");
    modal.className="modal"; modal.style.display="flex";
    modal.innerHTML=`<div class="modal-content" style="max-width:900px">
      <div class="modal-header"><div><span class="section-label">HISTORIAL</span><h2>Ficha del cliente</h2></div><button class="modal-close">×</button></div>
      <div id="clientHistoryBody">Cargando...</div>
    </div>`;
    document.body.appendChild(modal);
    const close=()=>modal.remove(); modal.querySelector(".modal-close").onclick=close;
    api("/api/admin/clients/"+id+"/history").then(data=>{
      const c=data.client,s=data.summary;
      $("clientHistoryBody").innerHTML=`
        <div class="job-detail-grid">
          <div><span>Cliente</span><strong>${esc(c.name)}</strong></div>
          <div><span>Teléfono</span><strong>${esc(c.phone)}</strong></div>
          <div><span>Email</span><strong>${esc(c.email||"-")}</strong></div>
          <div><span>Localidad</span><strong>${esc(c.locality||"-")}</strong></div>
          <div><span>Solicitudes</span><strong>${s.requests}</strong></div>
          <div><span>Presupuestos</span><strong>${s.quotes}</strong></div>
          <div><span>Trabajos</span><strong>${s.jobs}</strong></div>
          <div><span>Total presupuestado</span><strong>${money(s.totalQuoted)}</strong></div>
        </div>
        <hr>
        <h3>Solicitudes</h3>
        <div>${data.requests.map(r=>`<div class="account-field"><span>📋</span><div><strong>${esc(r.service||"Solicitud")}</strong><small>${esc(r.status)} · ${new Date(r.created_at).toLocaleString("es-AR")}</small></div></div>`).join("")||"Sin solicitudes."}</div>
        <h3>Presupuestos</h3>
        <div>${data.quotes.map(q=>`<div class="account-field"><span>💰</span><div><strong>${esc(q.quote_number||("#"+q.id))}</strong><small>${esc(q.status)} · ${money(q.total)}</small></div></div>`).join("")||"Sin presupuestos."}</div>
        <h3>Trabajos</h3>
        <div>${data.jobs.map(j=>`<div class="account-field"><span>🔧</span><div><strong>Trabajo #${j.id}</strong><small>${esc(j.status)} · ${esc(j.service||"")}</small></div></div>`).join("")||"Sin trabajos."}</div>`;
    }).catch(err=>{$("clientHistoryBody").textContent=err.message;});
  }

  async function loadClients() {
    const box=$("clients"), loading=$("clientsLoading"), empty=$("clientsEmpty");
    if(!box)return;
    loading.hidden=false; empty.hidden=true;
    try{
      const search=$("clientsSearch")?.value.trim()||"";
      const locality=$("clientsLocality")?.value.trim()||"";
      const params=new URLSearchParams({search,locality});
      const data=await api("/api/admin/clients?"+params.toString());
      const clients=data.clients||[];
      box.innerHTML="";
      if(!clients.length){empty.hidden=false;return;}
      const table=document.createElement("table");
      table.innerHTML=`<thead><tr><th>Cliente</th><th>Contacto</th><th>Localidad</th><th>Actividad</th><th>Acciones</th></tr></thead><tbody></tbody>`;
      const tbody=table.querySelector("tbody");
      clients.forEach(c=>{
        const tr=document.createElement("tr");
        tr.innerHTML=`
          <td><strong>${esc(c.name)}</strong><br><small>${esc(c.email||"Sin email")}</small></td>
          <td>${esc(c.phone)}<br><small>WA: ${esc(c.whatsapp||"-")}</small></td>
          <td>${esc(c.locality||"-")}</td>
          <td>${c.requests} solicitudes · ${c.quotes} presupuestos · ${c.jobs} trabajos</td>
          <td>
            <button class="btn tiny" data-history>📋 Historial</button>
            <button class="btn tiny ghost" data-edit>✏️ Editar</button>
            <button class="btn tiny ghost" data-delete>🗑️</button>
          </td>`;
        tr.querySelector("[data-history]").onclick=()=>openHistory(c.id);
        tr.querySelector("[data-edit]").onclick=()=>openEditor(c);
        tr.querySelector("[data-delete]").onclick=async()=>{
          if(!confirm("¿Eliminar este cliente? Las solicitudes históricas quedarán sin cliente asignado."))return;
          try{await api("/api/admin/clients/"+c.id,{method:"DELETE"});await loadClients();}catch(err){alert(err.message);}
        };
        tbody.appendChild(tr);
      });
      box.appendChild(table);
    }catch(err){box.innerHTML=`<div class="admin-error">${esc(err.message)}</div>`;}
    finally{loading.hidden=true;}
  }

  window.adminClientsNotice = msg => {
    if(typeof window.showMsg==="function") window.showMsg(msg);
  };

  $("newClientButton")?.addEventListener("click",()=>openEditor());
  $("refreshClients")?.addEventListener("click",loadClients);
  $("clearClientsSearch")?.addEventListener("click",()=>{$("clientsSearch").value="";$("clientsLocality").value="";loadClients();});
  $("clientsSearch")?.addEventListener("input",()=>{clearTimeout(window.clientSearchTimer);window.clientSearchTimer=setTimeout(loadClients,250);});
  $("clientsLocality")?.addEventListener("input",()=>{clearTimeout(window.clientLocalityTimer);window.clientLocalityTimer=setTimeout(loadClients,250);});

  loadClients();
})();