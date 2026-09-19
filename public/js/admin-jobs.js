// =====================================================
// FASE 8 — GESTIÓN AVANZADA DE TRABAJOS
// =====================================================

const JOB_STATUS_LABELS = {
  pendiente_presupuesto:"🟡 Pendiente de presupuesto",
  presupuesto_enviado:"🔵 Presupuesto enviado",
  aceptado:"🟢 Aceptado / confirmado",
  programado:"📅 Programado",
  en_proceso:"🔧 En proceso",
  pausado:"⏸️ Pausado",
  finalizado:"✅ Finalizado",
  cerrado:"⚫ Cerrado",
  rechazado:"🔴 Rechazado",
  cancelado:"🚫 Cancelado"
};

function jobStatusInfo(status){
  return {
    label:JOB_STATUS_LABELS[status]||status||"Desconocido",
    className:"status-"+String(status||"").replace(/_/g,"-")
  };
}

function jobMoney(value){
  return Number(value||0).toLocaleString("es-AR",{style:"currency",currency:"ARS"});
}

function jobDate(value){
  if(!value)return "-";
  const d=new Date(value);
  return Number.isNaN(d.getTime())?"-":d.toLocaleString("es-AR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
}

function jobDateOnly(value){
  if(!value)return "-";
  const d=new Date(value);
  return Number.isNaN(d.getTime())?"-":d.toLocaleDateString("es-AR");
}

function jobEscape(value){
  return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

async function jobApi(url,options={}){
  const response=await fetch(url,{credentials:"same-origin",...options});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"No se pudo completar la operación.");
  return data;
}

async function loadJobs(){
  const list=document.getElementById("jobsList");
  if(!list)return;
  const loading=document.getElementById("jobsLoading");
  const empty=document.getElementById("jobsEmpty");
  try{
    if(loading)loading.hidden=false;
    const params=new URLSearchParams();
    const search=document.getElementById("jobsSearch")?.value.trim()||"";
    const status=document.getElementById("jobsStatusFilter")?.value||"";
    const assigned=document.getElementById("jobsAssignedFilter")?.value||"";
    const from=document.getElementById("jobsDateFrom")?.value||"";
    const to=document.getElementById("jobsDateTo")?.value||"";
    if(search)params.set("search",search);
    if(status)params.set("status",status);
    if(assigned)params.set("assigned_user_id",assigned);
    if(from)params.set("date_from",from);
    if(to)params.set("date_to",to);
    const data=await jobApi("/api/admin/jobs?"+params.toString());
    const jobs=Array.isArray(data.jobs)?data.jobs:[];
    list.innerHTML="";
    if(empty)empty.hidden=jobs.length!==0;
    jobs.forEach(job=>list.appendChild(createJobCard(job)));
  }catch(error){
    list.innerHTML=`<div class="admin-error">${jobEscape(error.message)}</div>`;
  }finally{
    if(loading)loading.hidden=true;
  }
}

function createJobCard(job){
  const card=document.createElement("article");
  card.className="job-card";
  const info=jobStatusInfo(job.status);
  let actions="";
  if(job.status==="aceptado")actions+=`<button class="btn btn-primary btn-small" onclick="setJobStatus(${job.id},'programado')">📅 Programar</button><button class="btn btn-primary btn-small" onclick="setJobStatus(${job.id},'en_proceso')">🔧 Iniciar</button>`;
  if(job.status==="programado")actions+=`<button class="btn btn-primary btn-small" onclick="setJobStatus(${job.id},'en_proceso')">🔧 Iniciar</button>`;
  if(job.status==="en_proceso")actions+=`<button class="btn btn-secondary btn-small" onclick="setJobStatus(${job.id},'pausado')">⏸️ Pausar</button><button class="btn btn-primary btn-small" onclick="setJobStatus(${job.id},'finalizado')">✅ Finalizar</button>`;
  if(job.status==="pausado")actions+=`<button class="btn btn-primary btn-small" onclick="setJobStatus(${job.id},'en_proceso')">▶️ Reanudar</button>`;
  if(job.status==="finalizado")actions+=`<button class="btn btn-primary btn-small" onclick="setJobStatus(${job.id},'cerrado')">⚫ Cerrar</button>`;
  actions+=`<button class="btn btn-secondary btn-small" onclick="openJobDetail(${job.id})">👁️ Detalle</button>`;
  card.innerHTML=`
    <div class="job-card-header">
      <div><strong>${jobEscape(job.client_name||"Sin nombre")}</strong><span class="job-quote-number">${jobEscape(job.quote_number||"")}</span></div>
      <span class="job-status ${info.className}">${jobEscape(info.label)}</span>
    </div>
    <div class="job-card-body">
      <div class="job-info"><span>📞 ${jobEscape(job.client_phone||"Sin teléfono")}</span><span>⚡ ${jobEscape(job.requested_service||"Sin servicio")}</span></div>
      <div class="job-description"><strong>Trabajo:</strong><p>${jobEscape(job.work_description||"Sin descripción")}</p></div>
      <div class="job-total"><span>Total</span><strong>${jobMoney(job.total)}</strong></div>
      <div class="job-dates">
        <span>📅 ${jobDate(job.scheduled_at)}</span>
        <span>👤 ${jobEscape(job.assigned_user_name||"Sin técnico")}</span>
        ${job.started_at?`<span>🔧 ${jobDate(job.started_at)}</span>`:""}
        ${job.completed_at?`<span>✅ ${jobDate(job.completed_at)}</span>`:""}
      </div>
    </div>
    <div class="job-card-actions">${actions}</div>
  `;
  return card;
}

async function loadJobAssignees(){
  const select=document.getElementById("jobsAssignedFilter");
  if(!select)return;
  try{
    const data=await jobApi("/api/admin/jobs/assignees");
    select.innerHTML='<option value="">Todos los técnicos</option>';
    (data.users||[]).forEach(user=>{
      const option=document.createElement("option");
      option.value=user.id;
      option.textContent=user.name;
      select.appendChild(option);
    });
  }catch(error){console.error(error);}
}

async function setJobStatus(id,status){
  const label=JOB_STATUS_LABELS[status]||status;
  if(!confirm("¿Cambiar el trabajo a: "+label+"?"))return;
  try{
    const data=await jobApi(`/api/admin/jobs/${id}/status`,{
      method:"PUT",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({status})
    });
    alert(data.message||"Estado actualizado.");
    await loadJobs();
    await loadJobsHistory();
  }catch(error){alert(error.message);}
}

async function openJobDetail(id){
  const modal=document.getElementById("jobDetailModal");
  const loading=document.getElementById("jobDetailLoading");
  const errorBox=document.getElementById("jobDetailError");
  const content=document.getElementById("jobDetailContent");
  if(!modal)return;
  modal.hidden=false;
  if(loading)loading.hidden=false;
  if(errorBox)errorBox.hidden=true;
  if(content)content.hidden=true;
  try{
    const data=await jobApi(`/api/admin/jobs/${id}`);
    const job=data.job;
    const info=jobStatusInfo(job.status);
    document.getElementById("jobDetailTitle").textContent="Trabajo "+(job.quote_number||"#"+id);
    document.getElementById("jobDetailStatus").textContent=info.label;
    document.getElementById("jobDetailClient").textContent=job.client_name||"-";
    document.getElementById("jobDetailPhone").textContent=job.client_phone||"-";
    document.getElementById("jobDetailEmail").textContent=job.client_email||"-";
    document.getElementById("jobDetailService").textContent=job.requested_service||"-";
    document.getElementById("jobDetailQuote").textContent=job.quote_number||"-";
    document.getElementById("jobDetailIssueDate").textContent=jobDateOnly(job.issue_date);
    document.getElementById("jobDetailDescription").textContent=job.work_description||"Sin descripción.";
    document.getElementById("jobDetailSubtotal").textContent=jobMoney(job.subtotal);
    document.getElementById("jobDetailDiscount").textContent=jobMoney(job.discount);
    document.getElementById("jobDetailTotal").textContent=jobMoney(job.total);
    document.getElementById("jobDetailCreated").textContent=jobDate(job.created_at);
    document.getElementById("jobDetailStarted").textContent=jobDate(job.started_at);
    document.getElementById("jobDetailCompleted").textContent=jobDate(job.completed_at);
    document.getElementById("jobDetailNotes").textContent=job.internal_notes||job.notes||"Sin observaciones.";

    const items=document.getElementById("jobDetailItems");
    items.innerHTML=(job.items||[]).length?(job.items||[]).map(item=>`
      <div class="job-detail-item"><div><strong>${jobEscape(item.description||"")}</strong><span>${Number(item.quantity||0)} ${jobEscape(item.unit||"")} × ${jobMoney(item.unit_price)}</span></div><strong>${jobMoney(item.total)}</strong></div>`).join(""):"<div>No hay conceptos.</div>";

    renderJobManagement(job,content);
    if(loading)loading.hidden=true;
    if(content)content.hidden=false;
  }catch(error){
    if(loading)loading.hidden=true;
    if(errorBox){errorBox.textContent=error.message;errorBox.hidden=false;}
  }
}

async function renderJobManagement(job,content){
  let panel=document.getElementById("jobAdvancedPanel");
  if(!panel){
    panel=document.createElement("div");
    panel.id="jobAdvancedPanel";
    panel.className="job-detail-section";
    content.appendChild(panel);
  }
  const assignees=await jobApi("/api/admin/jobs/assignees").catch(()=>({users:[]}));
  const history=job.history||[];
  const attachments=job.attachments||[];
  const options=Object.entries(JOB_STATUS_LABELS).map(([value,label])=>`<option value="${value}" ${job.status===value?"selected":""}>${jobEscape(label)}</option>`).join("");
  panel.innerHTML=`
    <span class="section-label">GESTIÓN OPERATIVA</span>
    <div class="job-detail-grid">
      <div><label>Técnico</label><select id="jobAssigned"><option value="">Sin asignar</option>${(assignees.users||[]).map(u=>`<option value="${u.id}" ${Number(job.assigned_user_id)===Number(u.id)?"selected":""}>${jobEscape(u.name)}</option>`).join("")}</select></div>
      <div><label>Fecha programada</label><input id="jobScheduled" type="datetime-local" value="${job.scheduled_at?String(job.scheduled_at).replace(" ","T").slice(0,16):""}"></div>
      <div><label>Ubicación</label><input id="jobLocation" maxlength="255" value="${jobEscape(job.location||"")}"></div>
      <div><label>Estado</label><select id="jobStatusSelect">${options}</select></div>
    </div>
    <label>Notas internas</label><textarea id="jobInternalNotes" rows="3" maxlength="10000">${jobEscape(job.internal_notes||"")}</textarea>
    <label>Notas de ejecución</label><textarea id="jobExecutionNotes" rows="3" maxlength="10000">${jobEscape(job.execution_notes||"")}</textarea>
    <button class="btn" type="button" onclick="saveJobDetails(${job.id})">💾 Guardar cambios</button>

    <div class="job-detail-section">
      <span class="section-label">EVIDENCIAS Y ARCHIVOS</span>
      <form id="jobAttachmentForm" style="display:flex;gap:8px;flex-wrap:wrap">
        <input type="file" id="jobAttachmentFile" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx,.txt" required>
        <select id="jobAttachmentCategory"><option value="inicio">Inicio</option><option value="proceso">Proceso</option><option value="final">Final</option><option value="documento">Documento</option><option value="otro">Otro</option></select>
        <button class="btn btn-small" type="submit">📎 Adjuntar</button>
      </form>
      <div id="jobAttachmentsList">${attachments.length?attachments.map(file=>`
        <div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08)">
          <a href="${jobEscape(file.url)}" target="_blank" rel="noopener noreferrer">${jobEscape(file.original_name)}</a>
          <span>${jobEscape(file.category)} · ${Math.round(Number(file.size_bytes||0)/1024)} KB <button class="btn btn-small" type="button" onclick="deleteJobAttachment(${job.id},${file.id})">🗑</button></span>
        </div>`).join(""):"<p>Sin archivos.</p>"}</div>
    </div>

    <div class="job-detail-section">
      <span class="section-label">HISTORIAL</span>
      ${history.length?history.map(item=>`<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08)"><strong>${jobEscape(item.action)}</strong><div>${jobEscape(item.old_status||"")} → ${jobEscape(item.new_status||"")}</div><small>${jobEscape(item.actor_name||"Sistema")} · ${jobDate(item.created_at)}</small></div>`).join(""):"<p>Sin movimientos.</p>"}
    </div>
  `;
  document.getElementById("jobAttachmentForm")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const file=document.getElementById("jobAttachmentFile")?.files?.[0];
    if(!file)return;
    const form=new FormData();
    form.append("file",file);
    form.append("category",document.getElementById("jobAttachmentCategory")?.value||"otro");
    try{
      await jobApi(`/api/admin/jobs/${job.id}/attachments`,{method:"POST",body:form});
      await openJobDetail(job.id);
    }catch(error){alert(error.message);}
  });
}

async function saveJobDetails(id){
  try{
    await jobApi(`/api/admin/jobs/${id}`,{
      method:"PUT",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        assigned_user_id:document.getElementById("jobAssigned")?.value||null,
        scheduled_at:document.getElementById("jobScheduled")?.value||null,
        location:document.getElementById("jobLocation")?.value||"",
        internal_notes:document.getElementById("jobInternalNotes")?.value||"",
        execution_notes:document.getElementById("jobExecutionNotes")?.value||""
      })
    });
    const selected=document.getElementById("jobStatusSelect")?.value;
    if(selected){
      const current=(await jobApi(`/api/admin/jobs/${id}`)).job.status;
      if(selected!==current)await jobApi(`/api/admin/jobs/${id}/status`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:selected})});
    }
    alert("Trabajo actualizado correctamente.");
    await openJobDetail(id);
    await loadJobs();
  }catch(error){alert(error.message);}
}

async function deleteJobAttachment(jobId,attachmentId){
  if(!confirm("¿Eliminar esta evidencia?"))return;
  try{await jobApi(`/api/admin/jobs/${jobId}/attachments/${attachmentId}`,{method:"DELETE"});await openJobDetail(jobId);}
  catch(error){alert(error.message);}
}

async function loadJobsHistory(){
  const list=document.getElementById("jobsHistoryList");
  if(!list)return;
  const loading=document.getElementById("jobsHistoryLoading");
  const empty=document.getElementById("jobsHistoryEmpty");
  try{
    if(loading)loading.hidden=false;
    const params=new URLSearchParams();
    const search=document.getElementById("jobsHistorySearch")?.value.trim()||"";
    const from=document.getElementById("jobsHistoryDateFrom")?.value||"";
    const to=document.getElementById("jobsHistoryDateTo")?.value||"";
    if(search)params.set("search",search);
    if(from)params.set("date_from",from);
    if(to)params.set("date_to",to);
    const data=await jobApi("/api/admin/jobs-history?"+params.toString());
    const jobs=data.jobs||[];
    list.innerHTML="";
    if(empty)empty.hidden=jobs.length!==0;
    const count=document.getElementById("historyCount");
    const total=document.getElementById("historyTotal");
    if(count)count.textContent=String(data.summary?.count??jobs.length);
    if(total)total.textContent=jobMoney(data.summary?.total||0);
    jobs.forEach(job=>{
      const card=document.createElement("article");
      card.className="job-history-card";
      card.innerHTML=`<div class="job-history-header"><div><strong>${jobEscape(job.client_name||"Sin nombre")}</strong><span class="job-quote-number">${jobEscape(job.quote_number||"")}</span></div><span class="job-status status-closed">${jobEscape(jobStatusInfo(job.status).label)}</span></div><div class="job-history-body"><div class="job-history-info"><span>📞 ${jobEscape(job.client_phone||"-")}</span><span>⚡ ${jobEscape(job.requested_service||"-")}</span><span>👤 ${jobEscape(job.assigned_user_name||"Sin técnico")}</span></div><div class="job-history-dates"><span>🔧 ${jobDate(job.started_at)}</span><span>✅ ${jobDate(job.completed_at)}</span></div><div class="job-history-total"><span>Total</span><strong>${jobMoney(job.total)}</strong></div><button class="btn btn-secondary btn-small" type="button" onclick="openJobDetail(${job.id})">👁️ Ver detalle</button></div>`;
      list.appendChild(card);
    });
  }catch(error){list.innerHTML=`<div class="admin-error">${jobEscape(error.message)}</div>`;}
  finally{if(loading)loading.hidden=true;}
}

function setupJobs(){
  const search=document.getElementById("jobsSearch");
  if(!search)return;
  let timer;
  const reload=()=>loadJobs();
  search.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(reload,300);});
  ["jobsStatusFilter","jobsAssignedFilter","jobsDateFrom","jobsDateTo"].forEach(id=>document.getElementById(id)?.addEventListener("change",reload));
  document.getElementById("refreshJobs")?.addEventListener("click",reload);
  document.getElementById("clearJobsFilters")?.addEventListener("click",()=>{
    search.value="";
    ["jobsStatusFilter","jobsAssignedFilter","jobsDateFrom","jobsDateTo"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
    reload();
  });
  document.getElementById("showAllJobs")?.addEventListener("click",()=>{document.getElementById("jobsStatusFilter").value="";reload();});
  document.getElementById("showClosedJobs")?.addEventListener("click",()=>{document.getElementById("jobsStatusFilter").value="cerrado";reload();});
  loadJobAssignees();
  loadJobs();
}

function setupJobsHistory(){
  const list=document.getElementById("jobsHistoryList");
  if(!list)return;
  const reload=()=>loadJobsHistory();
  let timer;
  document.getElementById("jobsHistorySearch")?.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(reload,300);});
  document.getElementById("jobsHistoryDateFrom")?.addEventListener("change",reload);
  document.getElementById("jobsHistoryDateTo")?.addEventListener("change",reload);
  document.getElementById("refreshJobsHistory")?.addEventListener("click",reload);
  document.getElementById("clearJobsHistoryFilters")?.addEventListener("click",()=>{
    ["jobsHistorySearch","jobsHistoryDateFrom","jobsHistoryDateTo"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
    reload();
  });
  document.getElementById("closeJobDetail")?.addEventListener("click",closeJobDetail);
  document.getElementById("closeJobDetailButton")?.addEventListener("click",closeJobDetail);
  document.getElementById("jobDetailModal")?.addEventListener("click",e=>{if(e.target.id==="jobDetailModal")closeJobDetail();});
  loadJobsHistory();
}

function closeJobDetail(){
  const modal=document.getElementById("jobDetailModal");
  if(modal)modal.hidden=true;
}

