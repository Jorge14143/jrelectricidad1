module.exports=function registerNotificationRoutes({app,pool,requireAdmin}){
  const ensure=async()=>{await pool.query(`CREATE TABLE IF NOT EXISTS notification_preferences (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    quote_requests TINYINT(1) NOT NULL DEFAULT 1,
    quote_status TINYINT(1) NOT NULL DEFAULT 1,
    jobs TINYINT(1) NOT NULL DEFAULT 1,
    payments TINYINT(1) NOT NULL DEFAULT 1,
    system TINYINT(1) NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query("INSERT INTO notification_preferences (id) VALUES (1) ON DUPLICATE KEY UPDATE id=id");
  };
  ensure().catch(e=>console.error("Error inicializando preferencias de notificaciones:",e));

  app.get("/api/admin/notifications/summary",requireAdmin,async(req,res)=>{
    try{
      const [[row]]=await pool.query("SELECT COUNT(*) total,SUM(is_read=0) unread FROM admin_notifications");
      const [types]=await pool.query("SELECT type,COUNT(*) total,SUM(is_read=0) unread FROM admin_notifications GROUP BY type ORDER BY unread DESC,total DESC");
      res.json({success:true,total:Number(row.total||0),unread:Number(row.unread||0),byType:types});
    }catch(e){res.status(500).json({error:"No se pudo cargar el resumen de notificaciones."});}
  });

  app.get("/api/admin/notifications/preferences",requireAdmin,async(req,res)=>{
    try{const [rows]=await pool.query("SELECT * FROM notification_preferences WHERE id=1");res.json({success:true,preferences:rows[0]||null});}
    catch(e){res.status(500).json({error:"No se pudieron cargar las preferencias."});}
  });

  app.put("/api/admin/notifications/preferences",requireAdmin,async(req,res)=>{
    try{
      const allowed=["quote_requests","quote_status","jobs","payments","system"];
      const values=allowed.map(k=>req.body[k]?1:0);
      await pool.query("UPDATE notification_preferences SET quote_requests=?,quote_status=?,jobs=?,payments=?,system=? WHERE id=1",values);
      res.json({success:true,message:"Preferencias de notificaciones guardadas."});
    }catch(e){res.status(500).json({error:"No se pudieron guardar las preferencias."});}
  });

  app.delete("/api/admin/notifications/read",requireAdmin,async(req,res)=>{
    try{await pool.query("DELETE FROM admin_notifications WHERE is_read=1");res.json({success:true,message:"Notificaciones leídas eliminadas."});}
    catch(e){res.status(500).json({error:"No se pudieron eliminar las notificaciones leídas."});}
  });
};