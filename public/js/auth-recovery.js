if(login) login.onsubmit=async e=>{e.preventDefault();try{const f=new FormData(login);const j=await api("/api/login",Object.fromEntries(f));location.href=j.user.role==="admin"?"/admin":"/";}catch(x){msg.textContent=x.message}};
const reg=document.getElementById("registerForm");
if(reg) reg.onsubmit=async e=>{e.preventDefault();try{const f=new FormData(reg);const j=await api("/api/register",Object.fromEntries(f));location.href="/";}catch(x){msg.textContent=x.message}};
const forgot=document.getElementById("forgotForm");
if(forgot) forgot.onsubmit=async e=>{e.preventDefault();try{const f=new FormData(forgot);const j=await api("/api/forgot-password",Object.fromEntries(f));msg.textContent=j.message;}catch(x){msg.textContent=x.message}};
const reset=document.getElementById("resetForm");
if(reset) reset.onsubmit=async e=>{e.preventDefault();const f=new FormData(reset);if(f.get("password")!==f.get("password2")){msg.textContent="Las contraseñas no coinciden.";return}try{const j=await api("/api/reset-password",{token:new URLSearchParams(location.search).get("token"),password:f.get("password")});msg.textContent=j.message;setTimeout(()=>location.href="/login.html",1500)}catch(x){msg.textContent=x.message}};

