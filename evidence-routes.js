const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const multer=require("multer");

function registerEvidenceRoutes({app,pool,requireAdmin}){
 const dir=path.join(__dirname,"public","uploads","evidence");
 fs.mkdirSync(dir,{recursive:true});
 const storage=multer.diskStorage({
  destination:(req,file,cb)=>cb(null,dir),
  filename:(req,file,cb)=>{
   const ext=path.extname(file.originalname).toLowerCase();
   cb(null,Date.now()+"-"+crypto.randomBytes(10).toString("hex")+ext);
  }
 });
 const upload=multer({
  storage,
  limits:{fileSize:10*1024*1024},
  fileFilter:(req,file,cb)=>{
   const allowed=["image/jpeg","image/png","image/webp","application/pdf"];
   cb(allowed.includes(file.mimetype)?null:new Error("Solo se permiten JPG, PNG, WEBP o PDF."),allowed.includes(file.mimetype));
  }
 });

 async function validateFile(req,res,next){
  if(!req.file)return next();
  try{
   const b=Buffer.alloc(12);const f=await fs.promises.open(req.file.path,"r");
   try{await f.read(b,0,12,0)}finally{await f.close()}
   const m=req.file.mimetype;
   const ok=(m==="image/jpeg"&&b[0]===255&&b[1]===216&&b[2]===255)||
    (m==="image/png"&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))||
    (m==="image/webp"&&b.subarray(0,4).toString()==="RIFF"&&b.subarray(8,12).toString()==="WEBP")||
    (m==="application/pdf"&&b.subarray(0,5).toString()==="%PDF-");
   if(!ok){await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El archivo no coincide con su tipo declarado."})}
   next();
  }catch(e){await fs.promises.unlink(req.file.path).catch(()=>{});res.status(400).json({error:"No se pudo validar el archivo."})}
 }

 const cleanType=v=>["general","before","after","document"].includes(v)?v:"general";
 const removeFile=url=>{if(!url)return;const p=path.join(__dirname,"public",String(url).replace(/^\/+ /,"").replace(/^\/+/, ""));if(p.startsWith(path.join(__dirname,"public","uploads","evidence")))fs.unlink(p,()=>{})};

 app.get("/api/admin/evidence/jobs",requireAdmin,async(req,res)=>{
  try{const [rows]=await pool.query(`SELECT j.id,j.quote_id,j.status,q.quote_number,qr.name AS client_name,qr.service AS requested_service FROM jobs j JOIN quotes q ON q.id=j.quote_id JOIN quote_requests qr ON qr.id=q.quote_request_id ORDER BY j.created_at DESC,j.id DESC`);res.json({success:true,jobs:rows})}
  catch(e){res.status(500).json({error:"No se pudieron cargar los trabajos."})}
 });

 app.get("/api/admin/evidence/job/:jobId",requireAdmin,async(req,res)=>{
  try{
   const id=Number(req.params.jobId);if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:"ID de trabajo inválido."});
   const [rows]=await pool.query(`SELECT e.*,u.name AS created_by_name FROM job_evidence e LEFT JOIN users u ON u.id=e.created_by WHERE e.job_id=? ORDER BY e.evidence_type,e.sort_order,e.created_at DESC`,[id]);
   res.json({success:true,evidence:rows});
  }catch(e){res.status(500).json({error:"No se pudo cargar la evidencia."})}
 });

 app.post("/api/admin/evidence",requireAdmin,upload.single("file"),validateFile,async(req,res)=>{
  try{
   if(!req.file)return res.status(400).json({error:"Seleccioná una imagen o PDF."});
   const jobId=Number(req.body.job_id),type=cleanType(req.body.evidence_type),title=String(req.body.title||req.file.originalname).trim(),description=String(req.body.description||"").trim();
   if(!Number.isInteger(jobId)||jobId<=0||!title)return res.status(400).json({error:"Trabajo y título son obligatorios."});
   const [jobs]=await pool.query("SELECT id,quote_id FROM jobs WHERE id=? LIMIT 1",[jobId]);
   if(!jobs.length){await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(404).json({error:"Trabajo no encontrado."})}
   const [[ord]]=await pool.query("SELECT COALESCE(MAX(sort_order),0)+1 next_order FROM job_evidence WHERE job_id=? AND evidence_type=?",[jobId,type]);
   const url="/uploads/evidence/"+req.file.filename;
   const [r]=await pool.query("INSERT INTO job_evidence(job_id,quote_id,evidence_type,title,description,file_url,original_name,mime_type,file_size,sort_order,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)",[jobId,jobs[0].quote_id,type,title,description,url,req.file.originalname,req.file.mimetype,req.file.size,ord.next_order,req.session.user.id]);
   res.status(201).json({success:true,id:r.insertId,message:"Evidencia guardada correctamente."});
  }catch(e){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});res.status(500).json({error:"No se pudo guardar la evidencia."})}
 });

 app.put("/api/admin/evidence/:id",requireAdmin,async(req,res)=>{
  try{const id=Number(req.params.id),title=String(req.body.title||"").trim(),description=String(req.body.description||"").trim(),type=cleanType(req.body.evidence_type);if(!id||!title)return res.status(400).json({error:"Datos inválidos."});await pool.query("UPDATE job_evidence SET title=?,description=?,evidence_type=? WHERE id=?",[title,description,type,id]);res.json({success:true})}
  catch(e){res.status(500).json({error:"No se pudo actualizar la evidencia."})}
 });

 app.delete("/api/admin/evidence/:id",requireAdmin,async(req,res)=>{
  try{const id=Number(req.params.id);const [rows]=await pool.query("SELECT file_url FROM job_evidence WHERE id=? LIMIT 1",[id]);if(!rows.length)return res.status(404).json({error:"Evidencia no encontrada."});await pool.query("DELETE FROM job_evidence WHERE id=?",[id]);removeFile(rows[0].file_url);res.json({success:true})}
  catch(e){res.status(500).json({error:"No se pudo eliminar la evidencia."})}
 });

 app.put("/api/admin/evidence/:id/order",requireAdmin,async(req,res)=>{
  try{const id=Number(req.params.id),direction=req.body.direction;const [rows]=await pool.query("SELECT id,job_id,evidence_type,sort_order FROM job_evidence WHERE id=? LIMIT 1",[id]);if(!rows.length)return res.status(404).json({error:"Evidencia no encontrada."});if(!["up","down"].includes(direction))return res.status(400).json({error:"Dirección inválida."});const c=rows[0];const op=direction==="up"?"<":">",dir=direction==="up"?"DESC":"ASC";const [n]=await pool.query("SELECT id,sort_order FROM job_evidence WHERE job_id=? AND evidence_type=? AND sort_order "+op+" ? ORDER BY sort_order "+dir+" LIMIT 1",[c.job_id,c.evidence_type,c.sort_order]);if(!n.length)return res.json({success:true});await pool.query("UPDATE job_evidence SET sort_order=? WHERE id=?",[n[0].sort_order,c.id]);await pool.query("UPDATE job_evidence SET sort_order=? WHERE id=?",[c.sort_order,n[0].id]);res.json({success:true})}
  catch(e){res.status(500).json({error:"No se pudo cambiar el orden."})}
 });
}
module.exports=registerEvidenceRoutes;