// JR ELECTRICIDAD — CONFIGURACIÓN V3
async function loadConfigurationV3(){
 try{
  const d=await api("/api/admin/configuration"),s=d.settings||{};
  const map={quote_validity_days:"configQuoteValidity",quote_default_notes:"configQuoteNotes",invoice_prefix:"configInvoicePrefix",invoice_tax_enabled:"configInvoiceTaxEnabled",invoice_tax_rate:"configInvoiceTaxRate",email_enabled:"configEmailEnabled",whatsapp_enabled:"configWhatsappEnabled",theme:"configTheme",timezone:"configTimezone"};
  Object.entries(map).forEach(([k,id])=>{const e=$(id);if(e){if(e.type==="checkbox")e.checked=s[k]==="1";else e.value=s[k]??"";}});
 }catch(e){console.error("Configuración V3:",e);}
}
async function saveConfigurationV3(ev){
 ev.preventDefault();const body={};
 [["quote_validity_days","configQuoteValidity"],["quote_default_notes","configQuoteNotes"],["invoice_prefix","configInvoicePrefix"],["invoice_tax_rate","configInvoiceTaxRate"],["timezone","configTimezone"]].forEach(([k,id])=>body[k]=$(id)?.value);
 body.invoice_tax_enabled=$("configInvoiceTaxEnabled")?.checked;
 body.email_enabled=$("configEmailEnabled")?.checked;
 body.whatsapp_enabled=$("configWhatsappEnabled")?.checked;
 body.theme=$("configTheme")?.value||"dark";
 try{await api("/api/admin/configuration",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});showMsg("Configuración V3 guardada correctamente.");}catch(e){showMsg(e.message||"No se pudo guardar la configuración.",true);}
}
function setupConfigurationV3(){$("configurationV3Form")?.addEventListener("submit",saveConfigurationV3);loadConfigurationV3();}
document.addEventListener("DOMContentLoaded",setupConfigurationV3);