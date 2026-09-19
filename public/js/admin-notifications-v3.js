// JR ELECTRICIDAD — NOTIFICACIONES V3
async function loadNotificationPreferences(){
  try{
    const data=await api("/api/admin/notifications/preferences");
    const p=data.preferences||{};
    ["quote_requests","quote_status","jobs","payments","system"].forEach(k=>{
      const el=$("notification_"+k); if(el) el.checked=Number(p[k])===1;
    });
    const summary=await api("/api/admin/notifications/summary");
    const badge=$("sidebarNotificationsBadge");
    if(badge){badge.textContent=Number(summary.unread||0);badge.hidden=Number(summary.unread||0)===0;}
  }catch(e){console.error("Notificaciones V3:",e);}
}
async function saveNotificationPreferences(event){
  event.preventDefault();
  const body={};
  ["quote_requests","quote_status","jobs","payments","system"].forEach(k=>body[k]=!!$("notification_"+k)?.checked);
  try{await api("/api/admin/notifications/preferences",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});showMsg("Preferencias de notificaciones guardadas correctamente.");}
  catch(e){showMsg(e.message||"No se pudieron guardar las preferencias.",true);}
}
function setupNotificationV3(){
  $("notificationPreferencesForm")?.addEventListener("submit",saveNotificationPreferences);
  loadNotificationPreferences();
}
document.addEventListener("DOMContentLoaded",setupNotificationV3);