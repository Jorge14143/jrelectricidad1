const crypto=require("crypto");

function base32Encode(buffer){
 const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let bits=0,value=0,out="";
 for(const byte of buffer){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}}
 if(bits>0)out+=alphabet[(value<<(5-bits))&31];return out;
}
function base32Decode(input){
 const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let bits=0,value=0,out=[];
 for(const c of String(input).toUpperCase().replace(/=+$/,"")){const n=alphabet.indexOf(c);if(n<0)throw new Error("Secret inválido");value=(value<<5)|n;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}}
 return Buffer.from(out);
}
function totp(secret,step=Math.floor(Date.now()/1000/30)){
 const key=base32Decode(secret);const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(step));
 const h=crypto.createHmac("sha1",key).update(b).digest();const o=h[h.length-1]&15;
 const n=(h.readUInt32BE(o)&0x7fffffff)%1000000;return String(n).padStart(6,"0");
}
function validTotp(secret,code){
 const clean=String(code||"").replace(/\D/g,"");if(clean.length!==6)return false;
 const now=Math.floor(Date.now()/1000/30);
 return [-1,0,1].some(d=>crypto.timingSafeEqual(Buffer.from(totp(secret,now+d)),Buffer.from(clean)));
}
function makeSecret(){return base32Encode(crypto.randomBytes(20));}

module.exports=function registerSecurityRoutes({app,pool,requireAdmin,cleanUser}){
 app.get("/api/admin/security",requireAdmin,async(req,res)=>{
  try{const [r]=await pool.query("SELECT two_factor_enabled FROM admin_security WHERE id=1");res.json({success:true,twoFactorEnabled:Boolean(r[0]?.two_factor_enabled)});}
  catch(e){res.status(500).json({error:"No se pudo obtener la configuración de seguridad."});}
 });
 app.post("/api/admin/security/2fa/setup",requireAdmin,async(req,res)=>{
  try{
   const secret=makeSecret();
   await pool.query("UPDATE admin_security SET two_factor_enabled=0,two_factor_secret=? WHERE id=1",[secret]);
   const label=encodeURIComponent("JR Electricidad: "+String(req.session.user.email||"admin"));
   const uri="otpauth://totp/"+label+"?secret="+secret+"&issuer=JR%20Electricidad";
   res.json({success:true,secret,otpauth_uri:uri});
  }catch(e){res.status(500).json({error:"No se pudo preparar 2FA."});}
 });
 app.post("/api/admin/security/2fa/enable",requireAdmin,async(req,res)=>{
  try{
   const [r]=await pool.query("SELECT two_factor_secret FROM admin_security WHERE id=1");
   if(!r[0]?.two_factor_secret)return res.status(400).json({error:"Primero generá una clave 2FA."});
   const secret=Buffer.isBuffer(r[0].two_factor_secret)?r[0].two_factor_secret.toString():String(r[0].two_factor_secret);
   if(!validTotp(secret,req.body.code))return res.status(400).json({error:"Código 2FA inválido."});
   await pool.query("UPDATE admin_security SET two_factor_enabled=1 WHERE id=1");
   res.json({success:true,message:"2FA activado correctamente."});
  }catch(e){res.status(500).json({error:"No se pudo activar 2FA."});}
 });
 app.post("/api/admin/security/2fa/disable",requireAdmin,async(req,res)=>{
  try{
   const [r]=await pool.query("SELECT two_factor_secret FROM admin_security WHERE id=1");
   const secret=r[0]?.two_factor_secret;
   const text=Buffer.isBuffer(secret)?secret.toString():String(secret||"");
   if(!validTotp(text,req.body.code))return res.status(400).json({error:"Código 2FA inválido."});
   await pool.query("UPDATE admin_security SET two_factor_enabled=0,two_factor_secret=NULL WHERE id=1");
   res.json({success:true,message:"2FA desactivado."});
  }catch(e){res.status(500).json({error:"No se pudo desactivar 2FA."});}
 });
 app.post("/api/login/2fa",async(req,res)=>{
  try{
   const pending=req.session.pending2fa;if(!pending?.userId)return res.status(401).json({error:"La sesión de autenticación expiró."});
   const [r]=await pool.query("SELECT id,name,email,role,created_at FROM users WHERE id=? LIMIT 1",[pending.userId]);
   const [s]=await pool.query("SELECT two_factor_enabled,two_factor_secret FROM admin_security WHERE id=1");
   if(!r.length||r[0].role!=="admin"||!s[0]?.two_factor_enabled)return res.status(401).json({error:"No se pudo validar la autenticación de dos factores."});
   const secret=Buffer.isBuffer(s[0].two_factor_secret)?s[0].two_factor_secret.toString():String(s[0].two_factor_secret||"");
   if(!validTotp(secret,req.body.code))return res.status(401).json({error:"Código 2FA incorrecto."});
   const user=cleanUser(r[0]);delete req.session.pending2fa;req.session.user=user;
   await new Promise((resolve,reject)=>req.session.save(err=>err?reject(err):resolve()));
   res.json({ok:true,user});
  }catch(e){res.status(500).json({error:"No se pudo completar el inicio de sesión."});}
 });
 app.get("/api/admin/security/audit",requireAdmin,async(req,res)=>{
  try{
   const limit=Math.min(200,Math.max(1,Number(req.query.limit)||100));
   const [rows]=await pool.query("SELECT a.*,u.name AS user_name,u.email AS user_email FROM security_audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT ?",[limit]);
   res.json({success:true,audit:rows});
  }catch(e){res.status(500).json({error:"No se pudo obtener la auditoría."});}
 });
};
module.exports.validTotp=validTotp;