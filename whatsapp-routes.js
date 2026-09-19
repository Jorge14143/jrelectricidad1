function registerWhatsappRoutes({ app, pool, requireAdmin }) {
  const admin=[requireAdmin];

  function normalizePhone(value){
    let p=String(value||"").replace(/[^\d+]/g,"");
    if(p.startsWith("+")) p=p.slice(1);
    if(p.startsWith("0")) p="54"+p.slice(1);
    if(p.length===10 && p.startsWith("3")) p="54"+p;
    return p;
  }
  function applyTemplate(body, vars={}){
    return String(body||"").replace(/\{([a-zA-Z0-9_]+)\}/g,(_,k)=>String(vars[k]??""));
  }

  app.locals.prepareWhatsappMessage = async (data) => {
    const phone=normalizePhone(data.phone), name=String(data.recipient_name||"").trim(), eventKey=String(data.event_key||"general").trim();
    const vars=data.variables&&typeof data.variables==="object"?data.variables:{};
    if(!phone||phone.length<10) throw new Error("Número de WhatsApp inválido.");
    let template=null;
    if(data.template_id){const [t]=await pool.query("SELECT * FROM whatsapp_templates WHERE id=? AND active=1 LIMIT 1",[Number(data.template_id)]);template=t[0]||null;}
    else {const [t]=await pool.query("SELECT * FROM whatsapp_templates WHERE event_key=? AND active=1 ORDER BY id LIMIT 1",[eventKey]);template=t[0]||null;}
    const text=applyTemplate(template?.body||String(data.message||""),{cliente:name,...vars});
    if(!text.trim()) throw new Error("El mensaje no puede estar vacío.");
    const [r]=await pool.query("INSERT INTO whatsapp_messages(template_id,event_key,recipient_name,recipient_phone,message_text,target_type,target_id) VALUES(?,?,?,?,?,?,?)",[template?.id||null,eventKey,name,phone,text,String(data.target_type||""),data.target_id?Number(data.target_id):null]);
    return {id:r.insertId,url:"https://wa.me/"+phone+"?text="+encodeURIComponent(text),message:text,phone};
  };

  app.get("/api/admin/whatsapp/templates",...admin,async(req,res)=>{
    try{const [rows]=await pool.query("SELECT * FROM whatsapp_templates ORDER BY event_key,name");res.json(rows);}
    catch(e){console.error(e);res.status(500).json({error:"No se pudieron cargar las plantillas."});}
  });

  app.post("/api/admin/whatsapp/templates",...admin,async(req,res)=>{
    const name=String(req.body?.name||"").trim(),eventKey=String(req.body?.event_key||"").trim(),body=String(req.body?.body||"").trim();
    if(!name||!eventKey||!body)return res.status(400).json({error:"Nombre, evento y mensaje son obligatorios."});
    if(name.length>120||eventKey.length>80||body.length>5000)return res.status(400).json({error:"La plantilla supera el límite permitido."});
    try{const [r]=await pool.query("INSERT INTO whatsapp_templates(name,event_key,body) VALUES(?,?,?)",[name,eventKey,body]);res.status(201).json({id:r.insertId,name,event_key:eventKey,body});}
    catch(e){if(e.code==="ER_DUP_ENTRY")return res.status(409).json({error:"Ya existe una plantilla para ese evento con ese nombre."});console.error(e);res.status(500).json({error:"No se pudo crear la plantilla."});}
  });

  app.put("/api/admin/whatsapp/templates/:id",...admin,async(req,res)=>{
    const id=Number(req.params.id),name=String(req.body?.name||"").trim(),eventKey=String(req.body?.event_key||"").trim(),body=String(req.body?.body||"").trim(),active=req.body?.active===false?0:1;
    if(!id||!name||!eventKey||!body)return res.status(400).json({error:"Datos de plantilla inválidos."});
    try{await pool.query("UPDATE whatsapp_templates SET name=?,event_key=?,body=?,active=? WHERE id=?",[name,eventKey,body,active,id]);const [rows]=await pool.query("SELECT * FROM whatsapp_templates WHERE id=?",[id]);res.json(rows[0]||null);}
    catch(e){console.error(e);res.status(500).json({error:"No se pudo actualizar la plantilla."});}
  });

  app.delete("/api/admin/whatsapp/templates/:id",...admin,async(req,res)=>{
    try{await pool.query("DELETE FROM whatsapp_templates WHERE id=?",[Number(req.params.id)]);res.json({ok:true});}
    catch(e){console.error(e);res.status(500).json({error:"No se pudo eliminar la plantilla."});}
  });

  app.get("/api/admin/whatsapp/history",...admin,async(req,res)=>{
    try{const [rows]=await pool.query("SELECT id,event_key,recipient_name,recipient_phone,message_text,target_type,target_id,status,created_at FROM whatsapp_messages ORDER BY id DESC LIMIT 300");res.json(rows);}
    catch(e){console.error(e);res.status(500).json({error:"No se pudo cargar el historial de WhatsApp."});}
  });

  app.post("/api/admin/whatsapp/prepare",...admin,async(req,res)=>{
    const phone=normalizePhone(req.body?.phone),name=String(req.body?.recipient_name||"").trim(),eventKey=String(req.body?.event_key||"general").trim();
    const vars=req.body?.variables&&typeof req.body.variables==="object"?req.body.variables:{};
    if(!phone||phone.length<10)return res.status(400).json({error:"Número de WhatsApp inválido."});
    try{
      let template=null;
      if(req.body?.template_id) {
        const [t]=await pool.query("SELECT * FROM whatsapp_templates WHERE id=? AND active=1 LIMIT 1",[Number(req.body.template_id)]);template=t[0]||null;
      } else {
        const [t]=await pool.query("SELECT * FROM whatsapp_templates WHERE event_key=? AND active=1 ORDER BY id LIMIT 1",[eventKey]);template=t[0]||null;
      }
      const text=applyTemplate(template?.body||String(req.body?.message||""),{cliente:name,...vars});
      if(!text.trim())return res.status(400).json({error:"El mensaje no puede estar vacío."});
      const [r]=await pool.query("INSERT INTO whatsapp_messages(template_id,event_key,recipient_name,recipient_phone,message_text,target_type,target_id) VALUES(?,?,?,?,?,?,?)",[template?.id||null,eventKey,name,phone,text,String(req.body?.target_type||""),req.body?.target_id?Number(req.body.target_id):null]);
      const url="https://wa.me/"+phone+"?text="+encodeURIComponent(text);
      res.status(201).json({id:r.insertId,url,message:text,phone});
    }catch(e){console.error(e);res.status(500).json({error:"No se pudo preparar el mensaje de WhatsApp."});}
  });

  app.post("/api/admin/whatsapp/:id/opened",...admin,async(req,res)=>{
    try{await pool.query("UPDATE whatsapp_messages SET status='opened',opened_at=NOW() WHERE id=?",[Number(req.params.id)]);res.json({ok:true});}
    catch(e){res.status(500).json({error:"No se pudo registrar la apertura."});}
  });
}
module.exports=registerWhatsappRoutes;
