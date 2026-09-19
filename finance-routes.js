const mysql = require("mysql2/promise");

function dateOnly(value, fallback = null) {
  if (!value) return fallback;
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function invoiceNumber(quoteId) {
  return `SRV-${new Date().getFullYear()}-${String(quoteId).padStart(6, "0")}`;
}

async function ensureServiceInvoice(connectionOrPool, quoteId, options = {}) {
  const [rows] = await connectionOrPool.query(
    `SELECT id, total, status FROM quotes WHERE id = ? LIMIT 1`,
    [quoteId]
  );

  if (!rows.length) {
    throw new Error("Presupuesto no encontrado.");
  }

  if (!["aceptado", "cerrado"].includes(rows[0].status)) {
    throw new Error("Solo los presupuestos aceptados o cerrados pueden pasar a facturación.");
  }

  const total = money(rows[0].total);
  if (total === null) {
    throw new Error("El total del presupuesto no es válido.");
  }

  await connectionOrPool.query(
    `
    INSERT INTO service_invoices
      (quote_id, invoice_number, issue_date, due_date, total, notes)
    VALUES (?, ?, COALESCE(?, CURDATE()), ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      total = VALUES(total),
      due_date = COALESCE(VALUES(due_date), due_date),
      notes = COALESCE(NULLIF(VALUES(notes), ''), notes)
    `,
    [
      quoteId,
      invoiceNumber(quoteId),
      options.issueDate || null,
      options.dueDate || null,
      total,
      options.notes || "Registro de facturación del servicio."
    ]
  );

  const [invoiceRows] = await connectionOrPool.query(
    `SELECT * FROM service_invoices WHERE quote_id = ? LIMIT 1`,
    [quoteId]
  );

  return invoiceRows[0];
}

module.exports = function registerFinanceRoutes({ app, pool, requireAdmin }) {

  app.get("/api/admin/finance/summary", requireAdmin, async (req, res) => {
    try {
      const from = dateOnly(req.query.from);
      const to = dateOnly(req.query.to);
      const invoiceParams = [];
      let invoiceWhere = "";

      if (from) { invoiceWhere += " AND i.issue_date >= ?"; invoiceParams.push(from); }
      if (to) { invoiceWhere += " AND i.issue_date <= ?"; invoiceParams.push(to); }

      const [[invoiceAgg]] = await pool.query(
        `
        SELECT
          COUNT(*) AS invoices,
          COALESCE(SUM(i.total),0) AS billed,
          COALESCE(SUM(p.paid),0) AS collected
        FROM service_invoices i
        LEFT JOIN (
          SELECT invoice_id, SUM(amount) AS paid
          FROM service_payments
          GROUP BY invoice_id
        ) p ON p.invoice_id = i.id
        WHERE i.status <> 'anulada' ${invoiceWhere}
        `,
        invoiceParams
      );

      const expenseParams = [];
      let expenseWhere = "";
      if (from) { expenseWhere += " AND expense_date >= ?"; expenseParams.push(from); }
      if (to) { expenseWhere += " AND expense_date <= ?"; expenseParams.push(to); }

      const [[expenseAgg]] = await pool.query(
        `SELECT COALESCE(SUM(amount),0) AS expenses FROM business_expenses WHERE 1=1 ${expenseWhere}`,
        expenseParams
      );

      const [[receivableAgg]] = await pool.query(
        `
        SELECT COALESCE(SUM(GREATEST(i.total - COALESCE(p.paid,0),0)),0) AS receivable
        FROM service_invoices i
        LEFT JOIN (
          SELECT invoice_id, SUM(amount) AS paid
          FROM service_payments
          GROUP BY invoice_id
        ) p ON p.invoice_id = i.id
        WHERE i.status <> 'anulada' ${invoiceWhere}
        `,
        invoiceParams
      );

      const billed = Number(invoiceAgg.billed || 0);
      const collected = Number(invoiceAgg.collected || 0);
      const expenses = Number(expenseAgg.expenses || 0);

      res.json({
        success:true,
        invoices:Number(invoiceAgg.invoices || 0),
        billed,
        collected,
        receivable:Number(receivableAgg.receivable || 0),
        expenses,
        result:collected-expenses
      });
    } catch (error) {
      console.error("Error resumen financiero:", error);
      res.status(500).json({error:"No se pudo cargar el resumen financiero."});
    }
  });

  app.get("/api/admin/finance/invoices", requireAdmin, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `
        SELECT
          i.id, i.invoice_number, i.quote_id, q.quote_number,
          qr.name AS client_name, qr.email AS client_email,
          i.issue_date, i.due_date, i.total, i.status, i.notes,
          COALESCE(SUM(p.amount),0) AS paid,
          GREATEST(i.total-COALESCE(SUM(p.amount),0),0) AS balance
        FROM service_invoices i
        INNER JOIN quotes q ON q.id=i.quote_id
        INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
        LEFT JOIN service_payments p ON p.invoice_id=i.id
        GROUP BY i.id,i.invoice_number,i.quote_id,q.quote_number,
          qr.name,qr.email,i.issue_date,i.due_date,i.total,i.status,i.notes
        ORDER BY i.issue_date DESC,i.id DESC
        `
      );
      res.json({success:true,invoices:rows});
    } catch(error) {
      console.error("Error listado financiero:",error);
      res.status(500).json({error:"No se pudieron cargar los registros de facturación."});
    }
  });

  app.post("/api/admin/finance/invoices", requireAdmin, async (req,res) => {
    try {
      const quoteId=Number(req.body.quote_id);
      const dueDate=dateOnly(req.body.due_date);
      const notes=String(req.body.notes||"").trim().slice(0,2000);
      if(!Number.isInteger(quoteId)||quoteId<=0) return res.status(400).json({error:"Presupuesto inválido."});
      const invoice=await ensureServiceInvoice(pool,quoteId,{dueDate,notes});
      res.status(201).json({success:true,invoice});
    } catch(error) {
      const status=error.message==="Presupuesto no encontrado."?404:400;
      res.status(status).json({error:error.message});
    }
  });

  app.post("/api/admin/finance/invoices/:id/payments", requireAdmin, async (req,res) => {
    const invoiceId=Number(req.params.id);
    const amount=money(req.body.amount);
    const paymentDate=dateOnly(req.body.payment_date);
    const method=String(req.body.method||"otro").trim();
    const reference=String(req.body.reference||"").trim().slice(0,150);
    const notes=String(req.body.notes||"").trim().slice(0,1000);
    if(!Number.isInteger(invoiceId)||invoiceId<=0||amount===null||amount<=0)
      return res.status(400).json({error:"Datos de cobro inválidos."});
    if(!["efectivo","transferencia","tarjeta","otro"].includes(method))
      return res.status(400).json({error:"Medio de pago inválido."});

    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      const [rows]=await connection.query(
        `
        SELECT i.id,i.total,COALESCE(SUM(p.amount),0) AS paid
        FROM service_invoices i
        LEFT JOIN service_payments p ON p.invoice_id=i.id
        WHERE i.id=?
        GROUP BY i.id,i.total
        FOR UPDATE
        `,[invoiceId]
      );
      if(!rows.length){await connection.rollback();return res.status(404).json({error:"Registro de facturación no encontrado."});}
      const balance=Math.max(0,Number(rows[0].total)-Number(rows[0].paid));
      if(amount>balance+0.005){await connection.rollback();return res.status(400).json({error:`El cobro supera el saldo pendiente ($ ${balance.toFixed(2)}).`});}

      await connection.query(
        `INSERT INTO service_payments(invoice_id,amount,payment_date,method,reference,notes)
         VALUES(?,?,COALESCE(?,CURDATE()),?,?,?)`,
        [invoiceId,amount,paymentDate,method,reference,notes]
      );

      const [[paidRow]]=await connection.query(
        `SELECT COALESCE(SUM(amount),0) AS paid FROM service_payments WHERE invoice_id=?`,
        [invoiceId]
      );
      const paid=Number(paidRow.paid||0);
      const total=Number(rows[0].total||0);
      const status=paid>=total-0.005?"pagada":"parcial";
      await connection.query("UPDATE service_invoices SET status=? WHERE id=?",[status,invoiceId]);
      await connection.query(
        `INSERT INTO admin_notifications (type, quote_id, message)
         SELECT 'payment_received', i.quote_id, ?
         FROM service_invoices i WHERE i.id=?`,
        [`Se registró un cobro de $ ${amount.toFixed(2)}. Estado de la factura: ${status}.`, invoiceId]
      ).catch(error => console.error("No se pudo crear notificación de cobro:", error));

      await connection.commit();
      if (app.locals.runAutomation) app.locals.runAutomation("payment_received", {type:"payment",id:invoiceId,quote_id:rows[0].quote_id,name:"",message:`Se registró un cobro de $ ${amount.toFixed(2)}.`}).catch(console.error);
      res.status(201).json({success:true,paid,balance:Math.max(0,total-paid),status});
    }catch(error){
      await connection.rollback().catch(()=>{});
      console.error("Error registrando cobro:",error);
      res.status(500).json({error:"No se pudo registrar el cobro."});
    }finally{connection.release();}
  });

  app.get("/api/admin/finance/payments", requireAdmin, async (req,res) => {
    try{
      const [rows]=await pool.query(
        `
        SELECT p.id,p.invoice_id,i.invoice_number,q.quote_number,
          qr.name AS client_name,p.amount,p.payment_date,p.method,p.reference,p.notes,p.created_at
        FROM service_payments p
        INNER JOIN service_invoices i ON i.id=p.invoice_id
        INNER JOIN quotes q ON q.id=i.quote_id
        INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
        ORDER BY p.payment_date DESC,p.id DESC
        `
      );
      res.json({success:true,payments:rows});
    }catch(error){
      console.error("Error listado de pagos:",error);
      res.status(500).json({error:"No se pudieron cargar los pagos."});
    }
  });

  app.get("/api/admin/finance/expenses", requireAdmin, async (req,res) => {
    try{
      const [rows]=await pool.query(
        `SELECT id,expense_date,category,description,amount,notes,created_at
         FROM business_expenses ORDER BY expense_date DESC,id DESC`
      );
      res.json({success:true,expenses:rows});
    }catch(error){
      console.error("Error listado de gastos:",error);
      res.status(500).json({error:"No se pudieron cargar los gastos."});
    }
  });

  app.post("/api/admin/finance/expenses", requireAdmin, async (req,res) => {
    const expenseDate=dateOnly(req.body.expense_date);
    const category=String(req.body.category||"general").trim().slice(0,100);
    const description=String(req.body.description||"").trim().slice(0,500);
    const amount=money(req.body.amount);
    const notes=String(req.body.notes||"").trim().slice(0,1000);
    if(!expenseDate||!description||amount===null||amount<=0)
      return res.status(400).json({error:"Completá fecha, descripción e importe válido."});
    try{
      const [result]=await pool.query(
        `INSERT INTO business_expenses(expense_date,category,description,amount,notes)
         VALUES(?,?,?,?,?)`,
        [expenseDate,category,description,amount,notes]
      );
      res.status(201).json({success:true,expense_id:result.insertId});
    }catch(error){
      console.error("Error creando gasto:",error);
      res.status(500).json({error:"No se pudo registrar el gasto."});
    }
  });

  app.get("/api/admin/finance/clients", requireAdmin, async (req,res) => {
    try{
      const [rows]=await pool.query(
        `
        SELECT qr.email AS client_email,MAX(qr.name) AS client_name,
          COUNT(DISTINCT i.id) AS invoices,COALESCE(SUM(i.total),0) AS billed,
          COALESCE(SUM(p.paid),0) AS collected,
          GREATEST(COALESCE(SUM(i.total),0)-COALESCE(SUM(p.paid),0),0) AS receivable
        FROM service_invoices i
        INNER JOIN quotes q ON q.id=i.quote_id
        INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
        LEFT JOIN (
          SELECT invoice_id,SUM(amount) AS paid
          FROM service_payments GROUP BY invoice_id
        ) p ON p.invoice_id=i.id
        WHERE i.status<>'anulada'
        GROUP BY qr.email
        ORDER BY billed DESC,client_name ASC
        `
      );
      res.json({success:true,clients:rows});
    }catch(error){
      console.error("Error finanzas por cliente:",error);
      res.status(500).json({error:"No se pudieron cargar las finanzas por cliente."});
    }
  });

  app.locals.ensureServiceInvoice = ensureServiceInvoice;
};
