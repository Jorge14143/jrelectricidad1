const crypto = require("crypto");

function registerSignatureRoutes({ app, pool, requireAdmin, requireAuth }) {
  function validDataUrl(value) {
    return /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=\s]+$/.test(String(value || ""));
  }

  function hashEvidence(data) {
    return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
  }

  app.get("/api/admin/signatures", requireAdmin, async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT
          s.id, s.quote_id, s.document_type, s.document_id,
          s.signer_name, s.signer_email, s.signed_at,
          s.ip_address, s.evidence_hash,
          q.quote_number
        FROM digital_signatures s
        LEFT JOIN quotes q ON q.id = s.quote_id
        ORDER BY s.id DESC
        LIMIT 200
      `);
      res.json({ signatures: rows });
    } catch (error) {
      console.error("Error obteniendo firmas:", error);
      res.status(500).json({ error: "No se pudo obtener el historial de firmas." });
    }
  });

  app.get("/api/admin/signatures/quotes/:quoteId", requireAdmin, async (req, res) => {
    try {
      const quoteId = Number(req.params.quoteId);
      if (!Number.isInteger(quoteId) || quoteId < 1) {
        return res.status(400).json({ error: "Presupuesto inválido." });
      }
      const [rows] = await pool.query(
        "SELECT id,quote_id,document_type,document_id,signer_name,signer_email,signed_at,ip_address,evidence_hash FROM digital_signatures WHERE quote_id=? ORDER BY id DESC",
        [quoteId]
      );
      res.json({ signatures: rows });
    } catch (error) {
      console.error("Error obteniendo firmas del presupuesto:", error);
      res.status(500).json({ error: "No se pudieron obtener las firmas." });
    }
  });

  app.post("/api/public/quotes/:token/sign", async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const signerName = String(req.body.signer_name || "").trim();
      const signerEmail = String(req.body.signer_email || "").trim().toLowerCase() || null;
      const signatureData = String(req.body.signature_data || "").trim();

      if (!signerName || signerName.length > 150) {
        return res.status(400).json({ error: "Ingresá el nombre del firmante." });
      }
      if (signerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) {
        return res.status(400).json({ error: "Correo del firmante inválido." });
      }
      if (!validDataUrl(signatureData) || signatureData.length > 1200000) {
        return res.status(400).json({ error: "La firma no es válida." });
      }

      await connection.beginTransaction();

      const [quotes] = await connection.query(
        "SELECT id,quote_number,status FROM quotes WHERE access_token=? LIMIT 1 FOR UPDATE",
        [req.params.token]
      );
      if (!quotes.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Presupuesto no encontrado." });
      }

      const quote = quotes[0];
      if (!["enviado","aceptado"].includes(quote.status)) {
        await connection.rollback();
        return res.status(400).json({ error: "El presupuesto no está disponible para firma." });
      }

      const [existing] = await connection.query(
        "SELECT id FROM digital_signatures WHERE quote_id=? AND document_type='quote' LIMIT 1",
        [quote.id]
      );
      if (existing.length) {
        await connection.rollback();
        return res.status(409).json({ error: "Este presupuesto ya tiene una firma registrada." });
      }

      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim().slice(0,45);
      const userAgent = String(req.headers["user-agent"] || "").slice(0,500);
      const signedAt = new Date().toISOString();
      const evidenceHash = hashEvidence({
        quote_id: quote.id,
        quote_number: quote.quote_number,
        signer_name: signerName,
        signer_email: signerEmail,
        signature_data: signatureData,
        signed_at: signedAt,
        ip_address: ip,
        user_agent: userAgent
      });

      await connection.query(
        `INSERT INTO digital_signatures
         (quote_id,document_type,document_id,signer_name,signer_email,signature_data,signed_at,ip_address,user_agent,evidence_hash)
         VALUES (?, 'quote', ?, ?, ?, ?, NOW(), ?, ?, ?)`,
        [quote.id, quote.id, signerName, signerEmail, signatureData, ip || null, userAgent || null, evidenceHash]
      );

      if (quote.status === "enviado") {
        await connection.query(
          "UPDATE quotes SET status='aceptado' WHERE id=? AND status='enviado'",
          [quote.id]
        );
        await connection.query(
          `INSERT INTO jobs (quote_id,status)
           VALUES (?, 'aceptado')
           ON DUPLICATE KEY UPDATE status='aceptado'`,
          [quote.id]
        );
        await connection.query(
          `INSERT INTO admin_notifications (type,quote_id,message)
           VALUES ('quote_accepted',?,?)`,
          [quote.id, "El cliente " + signerName + " aceptó y firmó el presupuesto " + quote.quote_number + "."]
        );
        if (app.locals.ensureServiceInvoice) {
          await app.locals.ensureServiceInvoice(connection, quote.id, {
            issueDate: new Date().toISOString().slice(0,10),
            notes: "Generado automáticamente al aceptar el presupuesto mediante firma digital."
          });
        }
      }

      await connection.commit();
      res.json({ ok: true, signed: true, quote_id: quote.id, quote_number: quote.quote_number });
    } catch (error) {
      await connection.rollback().catch(() => {});
      console.error("Error registrando firma:", error);
      res.status(500).json({ error: "No se pudo registrar la firma." });
    } finally {
      connection.release();
    }
  });

  app.get("/api/public/quotes/:token/signature", async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT s.id,s.signer_name,s.signer_email,s.signed_at,s.evidence_hash,q.quote_number
         FROM digital_signatures s
         INNER JOIN quotes q ON q.id=s.quote_id
         WHERE q.access_token=? AND s.document_type='quote' LIMIT 1`,
        [req.params.token]
      );
      res.json({ signed: rows.length > 0, signature: rows[0] || null });
    } catch (error) {
      console.error("Error consultando firma:", error);
      res.status(500).json({ error: "No se pudo consultar la firma." });
    }
  });
}

module.exports = registerSignatureRoutes;
