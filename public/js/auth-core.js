const msg=document.getElementById("msg");
async function api(url, data){
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const j=await r.json(); if(!r.ok) throw new Error(j.error||"Error"); return j;
