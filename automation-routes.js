function registerAutomationRoutes({app,pool,requireAdmin}){
 const allowedEvents=["quote_accepted","quote_rejected","job_started","job_closed","payment_received","quote_expiring","invoice_overdue","manual"];
 const allowedActions=["notification","email","whatsapp"];
 const ensure=async()=>{await pool.query(`CREATE TABLE IF NOT EXISTS automation_rules (id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,name VARCHAR(150) NOT NULL,event_key VARCHAR(100) NOT NULL,action_type ENUM('notification','email','whatsapp') NOT NULL,delay_minutes INT NOT NULL DEFAULT 0,active TINYINT(1) NOT NULL DEFAULT 1,config JSON NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,INDEX idx_automation_event_active(event_key,active)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
 await pool.query(`CREATE TABLE IF NOT EXISTS automation_logs (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,rule_id INT UNSIGNED NULL,event_key VARCHAR(100) NOT NULL,target_type VARCHAR(50) NULL,target_id INT NULL,status ENUM('executed','skipped','failed') NOT NULL,message VARCHAR(1000) NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX idx_automation_logs_created(created_at),INDEX idx_automation_logs_event(event_key)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);};
 ensure().catch(e=>console.error("Automatizaciones:",e));
 async function log(rule,event,target,status,message){await pool.query("INSERT INTO automation_logs(rule_id,event_key,target_type,target_id,status,message) VALUES(?,?,?,?,?,?)",[rule?.id||null,event,target?.type||null,target?.id||null,status,String(message||"").slice(0,1000)]).catch(()=>{});}
 async function runAutomation(eventKey,target={}){
  const [rules]=await pool.query("SELECT * FROM automation_rules WHERE active=1 AND event_key=? ORDER BY id",[eventKey]);
  for(const rule of rules){
   try{
    const c=typeof rule.config==="string"?JSON.parse(rule.config||"{}"):(rule.config||{});
    if(rule.action_type==="notification"){
     await pool.query("INSERT INTO admin_notifications(type,quote_id,message) VALUES('system',?,?)",[target.quote_id||target.id||null,String(c.message||target.message||("Automatización: "+eventKey))]);
    } else if(rule.action_type==="email"){
     if(!app.locals.sendServiceEmail||!target.email){await log(rule,eventKey,target,"skipped","No hay servicio de email o destinatario.");continue;}
     await app.locals.sendServiceEmail({event_key:eventKey,recipient_name:target.name,recipient_email:target.email,subject:c.subject||("JR Electricidad — "+eventKey),body:c.body||target.message||("Notificación automática: "+eventKey),target_type:target.type,target_id:target.id});
    } else if(rule.action_type==="whatsapp"){
     if(!app.locals.prepareWhatsappMessage||!target.phone){await log(rule,eventKey,target,"skipped","No hay servicio de WhatsApp o destinatario.");continue;}
     await app.locals.prepareWhatsappMessage({event_key:eventKey,recipient_name:target.name,phone:target.phone,message:c.message||target.message,target_type:target.type,target_id:target.id});
    }
    await log(rule,eventKey,target,"executed","Automatización ejecutada.");
   }catch(e){await log(rule,eventKey,target,"failed",e.message);}
  }
 }
 app.locals.runAutomation=runAutomation;

 app.get("/api/admin/automations/rules",requireAdmin,async(req,res)=>{try{const [r]=await pool.query("SELECT * FROM automation_rules ORDER BY id");res.json({success:true,rules:r});}catch(e){res.status(500).json({error:"No se pudieron cargar las automatizaciones."});}});
 app.post("/api/admin/automations/rules",requireAdmin,async(req,res)=>{try{const name=String(req.body.name||"").trim(),eventKey=String(req.body.event_key||"").trim(),action=String(req.body.action_type||"notification"),delay=Math.max(0,Math.min(10080,Number(req.body.delay_minutes)||0));if(!name||!allowedEvents.includes(eventKey)||!allowedActions.includes(action))return res.status(400).json({error:"Regla de automatización inválida."});const config=JSON.stringify(req.body.config&&typeof req.body.config==="object"?req.body.config:{});const [r]=await pool.query("INSERT INTO automation_rules(name,event_key,action_type,delay_minutes,active,config) VALUES(?,?,?,?,1,?)",[name,eventKey,action,delay,config]);res.status(201).json({success:true,id:r.insertId});}catch(e){res.status(500).json({error:"No se pudo crear la automatización."});}});
 app.put("/api/admin/automations/rules/:id",requireAdmin,async(req,res)=>{try{const id=Number(req.params.id),name=String(req.body.name||"").trim(),eventKey=String(req.body.event_key||"").trim(),action=String(req.body.action_type||"notification"),delay=Math.max(0,Math.min(10080,Number(req.body.delay_minutes)||0)),active=req.body.active===false?0:1;if(!id||!name||!allowedEvents.includes(eventKey)||!allowedActions.includes(action))return res.status(400).json({error:"Regla inválida."});await pool.query("UPDATE automation_rules SET name=?,event_key=?,action_type=?,delay_minutes=?,active=?,config=? WHERE id=?",[name,eventKey,action,delay,active,JSON.stringify(req.body.config||{}),id]);res.json({success:true});}catch(e){res.status(500).json({error:"No se pudo actualizar la automatización."});}});
 app.delete("/api/admin/automations/rules/:id",requireAdmin,async(req,res)=>{try{await pool.query("DELETE FROM automation_rules WHERE id=?",[Number(req.params.id)]);res.json({success:true});}catch(e){res.status(500).json({error:"No se pudo eliminar la automatización."});}});
 app.get("/api/admin/automations/logs",requireAdmin,async(req,res)=>{try{const [r]=await pool.query("SELECT l.*,r.name AS rule_name FROM automation_logs l LEFT JOIN automation_rules r ON r.id=l.rule_id ORDER BY l.id DESC LIMIT 300");res.json({success:true,logs:r});}catch(e){res.status(500).json({error:"No se pudo cargar el historial de automatizaciones."});}});
 app.post("/api/admin/automations/run-due",requireAdmin,async(req,res)=>{try{await runDueAutomations();res.json({success:true,message:"Automatizaciones programadas ejecutadas."});}catch(e){res.status(500).json({error:"No se pudieron ejecutar las automatizaciones programadas."});}});
 async function runDueAutomations(){
  const [quotes]=await pool.query("SELECT q.id,q.quote_number,qr.name,qr.email,qr.phone,q.expiration_date FROM quotes q JOIN quote_requests qr ON qr.id=q.quote_request_id WHERE q.status='enviado' AND q.expiration_date IS NOT NULL AND q.expiration_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(),INTERVAL 1 DAY)");
  for(const q of quotes)await runAutomation("quote_expiring",{type:"quote",id:q.id,quote_id:q.id,name:q.name,email:q.email,phone:q.phone,message:"El presupuesto "+q.quote_number+" está próximo a vencer."});
  const [invoices]=await pool.query("SELECT i.id,i.invoice_number,i.quote_id,qr.name,qr.email,qr.phone FROM service_invoices i JOIN quotes q ON q.id=i.quote_id JOIN quote_requests qr ON qr.id=q.quote_request_id WHERE i.status IN ('pendiente','parcial') AND i.due_date IS NOT NULL AND i.due_date<CURDATE()");
  for(const i of invoices)await runAutomation("invoice_overdue",{type:"invoice",id:i.id,quote_id:i.quote_id,name:i.name,email:i.email,phone:i.phone,message:"El registro de facturación "+i.invoice_number+" tiene un saldo pendiente vencido."});
 }
 setInterval(()=>runDueAutomations().catch(e=>console.error("Automatizaciones programadas:",e)),15*60*1000);
 app.get("/api/admin/automations/status",requireAdmin,async(req,res)=>{const [[r]]=await pool.query("SELECT COUNT(*) total,SUM(active=1) active FROM automation_rules");res.json({success:true,total:Number(r.total||0),active:Number(r.active||0)});});
}
module.exports=registerAutomationRoutes;