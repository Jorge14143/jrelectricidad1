function renderEvidenceItem(x){
 const typeLabel={general:"General",before:"Antes",after:"Después",document:"Documento"}[x.evidence_type]||x.evidence_type;
 const visual=x.mime_type.startsWith("image/")?'<a href="'+x.file_url+'" target="_blank" rel="noopener"><img src="'+x.file_url+'" alt="'+h(x.title)+'"></a>':'<a class="evidence-v3-doc" href="'+x.file_url+'" target="_blank" rel="noopener">📄 PDF</a>';
 return '<article class="evidence-v3-item"><div class="evidence-v3-media">'+visual+'</div><div class="evidence-v3-content"><span class="evidence-v3-type">'+h(typeLabel)+'</span><h4>'+h(x.title)+'</h4><p>'+h(x.description||"")+'</p><small>'+h(x.original_name)+' · '+Math.max(1,Math.round(Number(x.file_size||0)/1024))+' KB</small><div class="evidence-v3-actions"><button class="btn tiny" onclick="editEvidence('+x.id+')">✏️ Editar</button><button class="btn tiny btn-secondary" onclick="moveEvidence('+x.id+',\'up\')">↑</button><button class="btn tiny btn-secondary" onclick="moveEvidence('+x.id+',\'down\')">↓</button><button class="btn tiny btn-secondary" onclick="deleteEvidence('+x.id+')">🗑️</button></div></div></article>';
}
async function loadEvidenceJobs(){try{const d=await api("/api/admin/evidence/jobs");const s=$("evidenceJobSelect");if(!s)return;s.innerHTML='<option value="">Seleccionar trabajo...</option>'+(d.jobs||[]).map(j=>'<option value="'+j.id+'">#'+h(j.id)+' · '+h(j.quote_number)+' · '+h(j.client_name)+' · '+h(j.requested_service||"Servicio")+'</option>').join("");}catch(e){console.error(e)}}
async function loadEvidence(){const id=Number($("evidenceJobSelect")?.value||0);const list=$("evidenceList"),info=$("evidenceJobInfo");if(!id){if(list)list.innerHTML='<p class="muted">Seleccioná un trabajo.</p>';if(info)info.textContent="Seleccioná un trabajo para ver sus evidencias.";return}try{const d=await api("/api/admin/evidence/job/"+id);const rows=d.evidence||[];if(info)info.textContent=rows.length+" evidencia(s) asociada(s) al trabajo #"+id+".";if(list)list.innerHTML=rows.length?rows.map(renderEvidenceItem).join(""):'<p class="muted">Este trabajo todavía no tiene evidencias.</p>';}catch(e){showMsg(e.message,true)}}
async function editEvidence(id){const title=prompt("Título de la evidencia:");if(title===null)return;const description=prompt("Descripción:", "")??"";const type=prompt("Tipo: general / before / after / document","general");if(!["general","before","after","document"].includes(type))return showMsg("Tipo inválido.",true);try{await api("/api/admin/evidence/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,description,evidence_type:type})});loadEvidence();}catch(e){showMsg(e.message,true)}}
async function moveEvidence(id,direction){try{await api("/api/admin/evidence/"+id+"/order",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({direction})});loadEvidence();}catch(e){showMsg(e.message,true)}}
async function deleteEvidence(id){if(!confirm("¿Eliminar esta evidencia? El archivo también será eliminado."))return;try{await api("/api/admin/evidence/"+id,{method:"DELETE"});loadEvidence();}catch(e){showMsg(e.message,true)}}
document.addEventListener("DOMContentLoaded",()=>{
 const select=$("evidenceJobSelect"),form=$("evidenceUploadForm");
 select?.addEventListener("change",loadEvidence);
 $("refreshEvidence")?.addEventListener("click",loadEvidence);
 form?.addEventListener("submit",async e=>{
  e.preventDefault();const jobId=Number(select?.value||0),file=$("evidenceFile")?.files?.[0];
  if(!jobId)return showMsg("Seleccioná un trabajo.",true);if(!file)return showMsg("Seleccioná un archivo.",true);
  const fd=new FormData();fd.append("job_id",jobId);fd.append("evidence_type",$("evidenceType").value);fd.append("title",$("evidenceTitle").value);fd.append("description",$("evidenceDescription").value);fd.append("file",file);
  try{await api("/api/admin/evidence",{method:"POST",body:fd});form.reset();loadEvidence();showMsg("Evidencia guardada correctamente.");}catch(x){showMsg(x.message,true)}
 });
 loadEvidenceJobs();
});