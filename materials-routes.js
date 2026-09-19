const PDFDocument = require("pdfkit");

function registerMaterialRoutes({ app, pool, requireAdmin }) {
  const admin = [requireAdmin];

  const cleanText = value => String(value ?? "").trim();

  async function materialById(id) {
    const [rows] = await pool.query(
      `SELECT m.id,m.name,m.description,m.category_id,m.unit_id,m.active,
              c.name AS category_name,u.name AS unit_name,u.symbol AS unit_symbol
         FROM materials m
         LEFT JOIN material_categories c ON c.id=m.category_id
         INNER JOIN material_units u ON u.id=m.unit_id
        WHERE m.id=? LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  app.get("/api/admin/materials/categories", ...admin, async (req,res) => {
    try {
      const [rows] = await pool.query("SELECT id,name FROM material_categories ORDER BY name");
      res.json(rows);
    } catch (error) {
      console.error("Material categories:", error);
      res.status(500).json({error:"No se pudieron cargar las categorías."});
    }
  });

  app.post("/api/admin/materials/categories", ...admin, async (req,res) => {
    const name=cleanText(req.body?.name);
    if(!name || name.length>100) return res.status(400).json({error:"Nombre de categoría inválido."});
    try {
      const [r]=await pool.query("INSERT INTO material_categories(name) VALUES(?)",[name]);
      res.status(201).json({id:r.insertId,name});
    } catch(error) {
      if(error.code==="ER_DUP_ENTRY") return res.status(409).json({error:"La categoría ya existe."});
      console.error(error); res.status(500).json({error:"No se pudo crear la categoría."});
    }
  });

  app.delete("/api/admin/materials/categories/:id", ...admin, async (req,res) => {
    try {
      await pool.query("DELETE FROM material_categories WHERE id=?",[Number(req.params.id)]);
      res.json({message:"Categoría eliminada."});
    } catch(error) {
      res.status(500).json({error:"No se pudo eliminar la categoría."});
    }
  });

  app.get("/api/admin/materials/units", ...admin, async (req,res) => {
    try {
      const [rows]=await pool.query("SELECT id,name,symbol FROM material_units ORDER BY name");
      res.json(rows);
    } catch(error) {
      console.error(error); res.status(500).json({error:"No se pudieron cargar las unidades."});
    }
  });

  app.post("/api/admin/materials/units", ...admin, async (req,res) => {
    const name=cleanText(req.body?.name), symbol=cleanText(req.body?.symbol);
    if(!name || !symbol || name.length>50 || symbol.length>20) return res.status(400).json({error:"Unidad inválida."});
    try {
      const [r]=await pool.query("INSERT INTO material_units(name,symbol) VALUES(?,?)",[name,symbol]);
      res.status(201).json({id:r.insertId,name,symbol});
    } catch(error) {
      if(error.code==="ER_DUP_ENTRY") return res.status(409).json({error:"La unidad o símbolo ya existe."});
      console.error(error); res.status(500).json({error:"No se pudo crear la unidad."});
    }
  });

  app.delete("/api/admin/materials/units/:id", ...admin, async (req,res) => {
    try {
      await pool.query("DELETE FROM material_units WHERE id=?",[Number(req.params.id)]);
      res.json({message:"Unidad eliminada."});
    } catch(error) {
      if(error.code==="ER_ROW_IS_REFERENCED_2") return res.status(409).json({error:"La unidad está asociada a materiales y no puede eliminarse."});
      res.status(500).json({error:"No se pudo eliminar la unidad."});
    }
  });

  app.get("/api/admin/materials", ...admin, async (req,res) => {
    try {
      const [rows]=await pool.query(
        `SELECT m.id,m.name,m.description,m.category_id,m.unit_id,m.active,
                c.name AS category_name,u.name AS unit_name,u.symbol AS unit_symbol
           FROM materials m
           LEFT JOIN material_categories c ON c.id=m.category_id
           INNER JOIN material_units u ON u.id=m.unit_id
          ORDER BY m.active DESC,m.name`
      );
      res.json(rows);
    } catch(error) {
      console.error(error); res.status(500).json({error:"No se pudieron cargar los materiales."});
    }
  });

  app.post("/api/admin/materials", ...admin, async (req,res) => {
    const name=cleanText(req.body?.name), description=cleanText(req.body?.description);
    const categoryId=req.body?.category_id ? Number(req.body.category_id) : null;
    const unitId=Number(req.body?.unit_id);
    if(!name || name.length>180 || !unitId) return res.status(400).json({error:"Nombre y unidad son obligatorios."});
    try {
      const [r]=await pool.query(
        "INSERT INTO materials(name,description,category_id,unit_id) VALUES(?,?,?,?)",
        [name,description||null,categoryId,unitId]
      );
      res.status(201).json(await materialById(r.insertId));
    } catch(error) {
      if(error.code==="ER_NO_REFERENCED_ROW_2") return res.status(400).json({error:"Categoría o unidad inexistente."});
      console.error(error); res.status(500).json({error:"No se pudo crear el material."});
    }
  });

  app.put("/api/admin/materials/:id", ...admin, async (req,res) => {
    const id=Number(req.params.id);
    const name=cleanText(req.body?.name), description=cleanText(req.body?.description);
    const categoryId=req.body?.category_id ? Number(req.body.category_id) : null;
    const unitId=Number(req.body?.unit_id);
    const active=req.body?.active===false ? 0 : 1;
    if(!id || !name || !unitId) return res.status(400).json({error:"Datos de material inválidos."});
    try {
      await pool.query(
        "UPDATE materials SET name=?,description=?,category_id=?,unit_id=?,active=? WHERE id=?",
        [name,description||null,categoryId,unitId,active,id]
      );
      const row=await materialById(id);
      if(!row) return res.status(404).json({error:"Material no encontrado."});
      res.json(row);
    } catch(error) {
      if(error.code==="ER_NO_REFERENCED_ROW_2") return res.status(400).json({error:"Categoría o unidad inexistente."});
      console.error(error); res.status(500).json({error:"No se pudo actualizar el material."});
    }
  });

  app.delete("/api/admin/materials/:id", ...admin, async (req,res) => {
    try {
      await pool.query("DELETE FROM materials WHERE id=?",[Number(req.params.id)]);
      res.json({message:"Material eliminado."});
    } catch(error) {
      if(error.code==="ER_ROW_IS_REFERENCED_2") return res.status(409).json({error:"El material está asociado a una lista de trabajo y no puede eliminarse. Desactivalo en su lugar."});
      res.status(500).json({error:"No se pudo eliminar el material."});
    }
  });

  app.get("/api/admin/materials/quotes", ...admin, async (req,res) => {
    try {
      const [rows]=await pool.query(
        `SELECT q.id,q.quote_number,q.issue_date,q.status,
                qr.name AS client_name,qr.service AS service
           FROM quotes q
           INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
          ORDER BY q.id DESC`
      );
      res.json(rows);
    } catch(error) {
      console.error(error); res.status(500).json({error:"No se pudieron cargar los presupuestos."});
    }
  });

  app.get("/api/admin/materials/quotes/:quoteId", ...admin, async (req,res) => {
    const quoteId=Number(req.params.quoteId);
    try {
      const [rows]=await pool.query(
        `SELECT qm.id,qm.quote_id,qm.material_id,qm.quantity,qm.notes,
                m.name,m.description,c.name AS category_name,u.name AS unit_name,u.symbol AS unit_symbol
           FROM quote_materials qm
           INNER JOIN materials m ON m.id=qm.material_id
           LEFT JOIN material_categories c ON c.id=m.category_id
           INNER JOIN material_units u ON u.id=m.unit_id
          WHERE qm.quote_id=? ORDER BY qm.id`,
        [quoteId]
      );
      res.json(rows);
    } catch(error) {
      console.error(error); res.status(500).json({error:"No se pudo cargar la lista de materiales."});
    }
  });

  app.post("/api/admin/materials/quotes/:quoteId", ...admin, async (req,res) => {
    const quoteId=Number(req.params.quoteId), materialId=Number(req.body?.material_id);
    const quantity=Number(req.body?.quantity), notes=cleanText(req.body?.notes);
    if(!quoteId || !materialId || !Number.isFinite(quantity) || quantity<=0) return res.status(400).json({error:"Material o cantidad inválidos."});
    try {
      await pool.query(
        `INSERT INTO quote_materials(quote_id,material_id,quantity,notes)
         VALUES(?,?,?,?)
         ON DUPLICATE KEY UPDATE quantity=VALUES(quantity),notes=VALUES(notes)`,
        [quoteId,materialId,quantity,notes||null]
      );
      res.status(201).json({message:"Material agregado a la lista."});
    } catch(error) {
      if(error.code==="ER_NO_REFERENCED_ROW_2") return res.status(400).json({error:"Presupuesto o material inexistente."});
      console.error(error); res.status(500).json({error:"No se pudo guardar el material."});
    }
  });

  app.delete("/api/admin/materials/quotes/:quoteMaterialId", ...admin, async (req,res) => {
    try {
      await pool.query("DELETE FROM quote_materials WHERE id=?",[Number(req.params.quoteMaterialId)]);
      res.json({message:"Material quitado de la lista."});
    } catch(error) {
      console.error(error); res.status(500).json({error:"No se pudo quitar el material."});
    }
  });

  app.get("/api/admin/materials/quotes/:quoteId/pdf", ...admin, async (req,res) => {
    const quoteId=Number(req.params.quoteId);
    try {
      const [rows]=await pool.query(
        `SELECT q.quote_number,q.issue_date,qr.name AS client_name,qr.service,
                qm.quantity,qm.notes,m.name,u.name AS unit_name,u.symbol AS unit_symbol,c.name AS category_name
           FROM quotes q
           INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
           INNER JOIN quote_materials qm ON qm.quote_id=q.id
           INNER JOIN materials m ON m.id=qm.material_id
           INNER JOIN material_units u ON u.id=m.unit_id
           LEFT JOIN material_categories c ON c.id=m.category_id
          WHERE q.id=? ORDER BY c.name,m.name`,
        [quoteId]
      );
      if(!rows.length) return res.status(404).json({error:"No hay materiales asociados a este presupuesto."});

      const doc=new PDFDocument({margin:45,size:"A4"});
      const number=rows[0].quote_number;
      res.setHeader("Content-Type","application/pdf");
      res.setHeader("Content-Disposition",`inline; filename="materiales-${String(number).replace(/[^a-zA-Z0-9_-]/g,"_")}.pdf"`);
      doc.pipe(res);
      doc.fontSize(20).text("JR ELECTRICIDAD");
      doc.moveDown(.25).fontSize(12).text("Lista técnica de materiales");
      doc.fontSize(10).text(`Presupuesto: ${number}`);
      doc.text(`Cliente: ${rows[0].client_name || "-"}`);
      doc.text(`Servicio: ${rows[0].service || "-"}`);
      doc.text(`Fecha: ${rows[0].issue_date ? new Date(rows[0].issue_date).toLocaleDateString("es-AR") : "-"}`);
      doc.moveDown();
      doc.fontSize(9).text("Material",45,170,{width:230});
      doc.text("Categoría",275,170,{width:95});
      doc.text("Cantidad",370,170,{width:70});
      doc.text("Unidad",440,170,{width:70});
      doc.moveTo(45,185).lineTo(545,185).stroke();
      let y=195;
      for(const row of rows){
        if(y>750){doc.addPage();y=55;}
        doc.fontSize(9).text(row.name,45,y,{width:230});
        doc.text(row.category_name || "-",275,y,{width:95});
        doc.text(String(row.quantity),370,y,{width:70});
        doc.text(row.unit_symbol || row.unit_name || "-",440,y,{width:70});
        y+=22;
        if(row.notes){doc.fontSize(8).fillColor("#666").text(`Nota: ${row.notes}`,45,y,{width:500});doc.fillColor("#000");y+=16;}
      }
      doc.moveDown();
      doc.fontSize(8).fillColor("#666").text("Documento técnico para planificación y ejecución del servicio. No incluye valores comerciales ni constituye un comprobante comercial.");
      doc.end();
    } catch(error) {
      console.error("Material PDF:",error);
      if(!res.headersSent) res.status(500).json({error:"No se pudo generar el PDF de materiales."});
    }
  });
}

module.exports = registerMaterialRoutes;
