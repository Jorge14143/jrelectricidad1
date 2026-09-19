const loginForm=document.getElementById("loginForm");
loginForm?.addEventListener("submit",async(event)=>{
 event.preventDefault();const button=loginForm.querySelector("button[type='submit']"),message=document.getElementById("msg");
 const email=loginForm.elements.email?.value.trim()||"",password=loginForm.elements.password?.value||"";
 if(message){message.textContent="Ingresando...";message.className="notice"} if(button)button.disabled=true;
 try{
  const data=await api("/api/login",{email,password});
  if(data.requiresTwoFactor){
   const code=window.prompt("JR Electricidad — ingresá el código de 6 dígitos de tu aplicación de autenticación:");
   if(!code)throw new Error("Se requiere el código de autenticación de dos factores.");
   const verified=await api("/api/login/2fa",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code})});
   if(message){message.textContent="✅ Sesión iniciada correctamente.";message.className="notice success"}
   window.location.href=verified.user?.role==="admin"?"/admin":"/";
   return;
  }
  if(message){message.textContent="✅ Sesión iniciada correctamente.";message.className="notice success"}
  window.location.href=data.user?.role==="admin"?"/admin":"/";
 }catch(error){if(message){message.textContent="❌ "+error.message;message.className="notice error"}}finally{if(button)button.disabled=false}
});