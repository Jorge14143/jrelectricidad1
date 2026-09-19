let materialState={materials:[],categories:[],units:[],quotes:[]};
const materialEsc=v=>h(v??"");
async function loadMaterialCatalog(){
 const r=await Promise.all([api("/api/admin/materials"),api("/api/admin/materials/categories"),api("/api/admin/materials/units"),api("/api/admin/materials/quotes")]);
 materialState={materials:r[0],categories:r[1],units:r[2],quotes:r[3]};
 renderMaterialOptions();renderMaterialCatalog();renderMaterialLists();renderQuoteOptions();
}
function renderMaterialOptions(){
 const c=$("materialCategory"),u=$("materialUnit"),m=$("quoteMaterialSelect");
 if(c)c.innerHTML='<option value="">Sin categoría</option>'+materialState.categories.map(x=>'<option value="'+x.id+'">'+materialEsc(x.name)+'</option>').join("");
 if(u)u.innerHTML=materialState.units.map(x=>'<option value="'+x.id+'">'+materialEsc(x.name)+' ('+materialEsc(x.symbol)+')</option>').join("");
 if(m)m.innerHTML='<option value="">Seleccionar material...</option>'+materialState.materials.filter(x=>x.active).map(x=>'<option value="'+x.id+'">'+materialEsc(x.name)+' · '+materialEsc(x.unit_symbol)+'</option>').join("");
}
function renderMaterialCatalog(){
 const b=$("materialsCatalog");if(!b)return;
 b.innerHTML=materialState.materials.length?materialState.materials.map(m=>'<tr><td><strong>'+materialEsc(m.name)+'</strong><small>'+materialEsc(m.description||"")+'</small></td><td>'+materialEsc(m.category_name||"Sin categoría")+'</td><td>'+materialEsc(m.unit_name)+' ('+materialEsc(m.unit_symbol)+')</td><td><span class="material-state '+(m.active?"active":"inactive")+'">'+(m.active?"Activo":"Inactivo")+'</span></td><td><button class="btn tiny" onclick="editMaterial('+m.id+')">✏️ Editar</button> <button class="btn tiny" onclick="deleteMaterial('+m.id+')">🗑️ Eliminar</button></td></tr>').join(""):'<tr><td colspan="5" class="muted">Todavía no hay materiales técnicos.</td></tr>';
}
function renderMaterialLists(){
 const c=$("materialCategoriesList"),u=$("materialUnitsList");
 if(c)c.innerHTML=materialState.categories.map(x=>'<span class="material-chip">'+materialEsc(x.name)+' <button onclick="deleteMaterialCategory('+x.id+')">×</button></span>').join("");
 if(u)u.innerHTML=materialState.units.map(x=>'<span class="material-chip">'+materialEsc(x.name)+' · '+materialEsc(x.symbol)+' <button onclick="deleteMaterialUnit('+x.id+')">×</button></span>').join("");
}
async function saveMaterial(e){
 e.preventDefault();const id=$("materialId").value;
 const body={name:$("materialName").value.trim(),description:$("materialDescription").value.trim(),category_id:$("materialCategory").value||null,unit_id:Number($("materialUnit").value),active:$("materialActive").checked};
 try{await api(id?"/api/admin/materials/"+id:"/api/admin/materials",{method:id?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});e.target.reset();$("materialId").value="";$("materialActive").checked=true;await loadMaterialCatalog();showMsg("Material guardado.");}catch(err){showMsg(err.message,true);}
}
function editMaterial(id){const m=materialState.materials.find(x=>x.id==id);if(!m)return;$("materialId").value=m.id;$("materialName").value=m.name;$("materialDescription").value=m.description||"";$("materialCategory").value=m.category_id||"";$("materialUnit").value=m.unit_id;$("materialActive").checked=!!m.active;window.scrollTo({top:0,behavior:"smooth"});}
async function deleteMaterial(id){if(!confirm("¿Eliminar este material técnico?"))return;try{await api("/api/admin/materials/"+id,{method:"DELETE"});await loadMaterialCatalog();}catch(e){showMsg(e.message,true);}}
async function addMaterialCategory(e){e.preventDefault();const name=$("newMaterialCategory").value.trim();if(!name)return;try{await api("/api/admin/materials/categories",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});e.target.reset();await loadMaterialCatalog();}catch(err){showMsg(err.message,true);}}
async function deleteMaterialCategory(id){if(!confirm("¿Eliminar categoría?"))return;try{await api("/api/admin/materials/categories/"+id,{method:"DELETE"});await loadMaterialCatalog();}catch(e){showMsg(e.message,true);}}
async function addMaterialUnit(e){e.preventDefault();const name=$("newMaterialUnit").value.trim(),symbol=$("newMaterialUnitSymbol").value.trim();if(!name||!symbol)return;try{await api("/api/admin/materials/units",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,symbol})});e.target.reset();await loadMaterialCatalog();}catch(err){showMsg(err.message,true);}}
async function deleteMaterialUnit(id){if(!confirm("¿Eliminar unidad?"))return;try{await api("/api/admin/materials/units/"+id,{method:"DELETE"});await loadMaterialCatalog();}catch(e){showMsg(e.message,true);}}
async function loadQuoteMaterials(){
 const id=$("materialQuoteSelect").value,box=$("quoteMaterialsList");if(!id){box.innerHTML='<p class="muted">Seleccioná un presupuesto para ver su lista técnica.</p>';return;}
 const rows=await api("/api/admin/materials/quotes/"+id);
 box.innerHTML=rows.length?rows.map(x=>'<div class="quote-material-row"><div><strong>'+materialEsc(x.name)+'</strong><small>'+materialEsc(x.category_name||"Sin categoría")+' · '+materialEsc(x.notes||"")+'</small></div><b>'+Number(x.quantity)+' '+materialEsc(x.unit_symbol)+'</b><button class="btn tiny" onclick="removeQuoteMaterial('+x.id+')">×</button></div>').join(""):'<p class="muted">No hay materiales asociados a este presupuesto.</p>';
}
async function addQuoteMaterial(e){e.preventDefault();const q=$("materialQuoteSelect").value,m=$("quoteMaterialSelect").value,quantity=Number($("quoteMaterialQuantity").value),notes=$("quoteMaterialNotes").value.trim();if(!q||!m||quantity<=0)return;try{await api("/api/admin/materials/quotes/"+q,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({material_id:Number(m),quantity,notes})});e.target.reset();$("quoteMaterialQuantity").value=1;await loadQuoteMaterials();}catch(err){showMsg(err.message,true);}}
async function removeQuoteMaterial(id){try{await api("/api/admin/materials/quotes/"+id,{method:"DELETE"});await loadQuoteMaterials();}catch(e){showMsg(e.message,true);}}
function openMaterialsPdf(){const id=$("materialQuoteSelect").value;if(id)window.open("/api/admin/materials/quotes/"+id+"/pdf","_blank");}
function renderQuoteOptions(){const s=$("materialQuoteSelect");if(!s)return;s.innerHTML='<option value="">Seleccionar presupuesto...</option>'+materialState.quotes.map(q=>'<option value="'+q.id+'">'+materialEsc(q.quote_number)+' · '+materialEsc(q.client_name||"")+' · '+materialEsc(q.status)+'</option>').join("");}
function setupMaterials(){
 if(!$("materialsSection"))return;
 $("materialForm")?.addEventListener("submit",saveMaterial);
 $("materialCategoryForm")?.addEventListener("submit",addMaterialCategory);
 $("materialUnitForm")?.addEventListener("submit",addMaterialUnit);
 $("materialQuoteForm")?.addEventListener("submit",addQuoteMaterial);
 $("materialQuoteSelect")?.addEventListener("change",loadQuoteMaterials);
 $("materialQuotePdf")?.addEventListener("click",openMaterialsPdf);
 loadMaterialCatalog().catch(e=>showMsg(e.message,true));
}
