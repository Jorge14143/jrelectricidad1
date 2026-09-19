module.exports=function registerConfigurationRoutes({app,pool,requireAdmin}){
 const allowed={
  quote_validity_days:v=>Math.max(1,Math.min(365,Number(v)||15)),
  quote_default_notes:v=>String(v||"").slice(0,5000),
  invoice_prefix:v=>String(v||"JR").trim().slice(0,20)||"JR",
  invoice_tax_enabled:v=>v==="1"||v===1||v===true?"1":"0",
  invoice_tax_rate:v=>{const n=Number(v);return String(Math.max(0,Math.min(100,Number.isFinite(n)?n:0)));},
  email_enabled:v=>v==="1"||v===1||v===true?"1":"0",
  whatsapp_enabled:v=>v==="1"||v===1||v===true?"1":"0",
  theme:v=>["dark"].includes(String(v))?"dark":"dark",
  timezone:v=>String(v||"America/Argentina/Buenos_Aires").slice(0,80)
 };
 app.get("/api/admin/configuration",requireAdmin,async(req,res)=>{
  try{
   const [rows]=await pool.query("SELECT setting_key,setting_value FROM app_settings");
   const settings={};rows.forEach(r=>settings[r.setting_key]=r.setting_value);
   res.json({success:true,settings});
  }catch(e){res.status(500).json({error:"No se pudo cargar la configuración V3."});}
 });
 app.put("/api/admin/configuration",requireAdmin,async(req,res)=>{
  const conn=await pool.getConnection();
  try{
   await conn.beginTransaction();
   for(const [key,fn] of Object.entries(allowed)){
    if(Object.prototype.hasOwnProperty.call(req.body,key)){
     const value=fn(req.body[key]);
     await conn.query("INSERT INTO app_settings(setting_key,setting_value) VALUES(?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",[key,value]);
    }
   }
   await conn.commit();res.json({success:true,message:"Configuración V3 guardada correctamente."});
  }catch(e){await conn.rollback();res.status(500).json({error:"No se pudo guardar la configuración V3."});}finally{conn.release();}
 });
};