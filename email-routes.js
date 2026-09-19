const nodemailer = require("nodemailer");

function registerEmailRoutes({ app, pool, requireAdmin }) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });

  function renderTemplate(text, variables = {}) {
    return String(text || "").replace(/\\{(\\w+)\\}/g, (_, key) =>
      String(variables[key] ?? "")
    );
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function validateEmail(email) {
    return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
  }

  async function createEmailMessage(connection, data) {
    const recipientEmail = normalizeEmail(data.recipient_email);
    if (!validateEmail(recipientEmail)) {
      throw new Error("Correo electrónico inválido.");
    }

    const [result] = await connection.query(
      `INSERT INTO email_messages
        (template_id,event_key,recipient_name,recipient_email,subject,body,target_type,target_id,status)
       VALUES (?,?,?,?,?,?,?,?, 'prepared')`,
      [
        data.template_id || null,
        data.event_key || "general",
        String(data.recipient_name || "").trim() || null,
        recipientEmail,
        String(data.subject || "").trim(),
        String(data.body || ""),
        String(data.target_type || "").trim() || null,
        data.target_id ? Number(data.target_id) : null
      ]
    );

    return result.insertId;
  }

  async function sendStoredEmail(messageId) {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(
        "SELECT * FROM email_messages WHERE id=? LIMIT 1",
        [messageId]
      );
      if (!rows.length) throw new Error("Correo no encontrado.");

      const message = rows[0];

      try {
        await transporter.sendMail({
          from: process.env.MAIL_FROM,
          to: message.recipient_email,
          subject: message.subject,
          text: message.body
        });

        await connection.query(
          "UPDATE email_messages SET status='sent', sent_at=NOW(), error_message=NULL WHERE id=?",
          [messageId]
        );

        return { ok: true, id: messageId };
      } catch (error) {
        await connection.query(
          "UPDATE email_messages SET status='failed', error_message=? WHERE id=?",
          [String(error.message || "Error de envío").slice(0, 1000), messageId]
        );
        throw error;
      }
    } finally {
      connection.release();
    }
  }

  // Se expone para que futuras automatizaciones puedan enviar emails desde
  // aceptación de presupuestos, turnos, trabajos y pagos sin duplicar lógica.
  app.locals.sendServiceEmail = async (data) => {
    const connection = await pool.getConnection();
    try {
      const id = await createEmailMessage(connection, data);
      await connection.commit();
      try {
        return await sendStoredEmail(id);
      } catch (error) {
        return { ok: false, id, error: error.message };
      }
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  };

  app.get("/api/admin/email/templates", requireAdmin, async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT id,name,event_key,subject,body,active,created_at,updated_at FROM email_templates ORDER BY event_key,name"
      );
      res.json({ templates: rows });
    } catch (error) {
      console.error("Error obteniendo plantillas de email:", error);
      res.status(500).json({ error: "No se pudieron obtener las plantillas." });
    }
  });

  app.post("/api/admin/email/templates", requireAdmin, async (req, res) => {
    try {
      const name = String(req.body.name || "").trim();
      const eventKey = String(req.body.event_key || "general").trim().toLowerCase();
      const subject = String(req.body.subject || "").trim();
      const body = String(req.body.body || "");

      if (!name || !eventKey || !subject || !body) {
        return res.status(400).json({ error: "Completá nombre, evento, asunto y mensaje." });
      }

      if (name.length > 150 || eventKey.length > 80 || subject.length > 255 || body.length > 20000) {
        return res.status(400).json({ error: "Uno de los campos supera el límite permitido." });
      }

      const [result] = await pool.query(
        "INSERT INTO email_templates (name,event_key,subject,body) VALUES (?,?,?,?)",
        [name,eventKey,subject,body]
      );

      res.status(201).json({ ok: true, id: result.insertId });
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "Ya existe una plantilla con ese nombre y evento." });
      }
      console.error("Error creando plantilla de email:", error);
      res.status(500).json({ error: "No se pudo crear la plantilla." });
    }
  });

  app.put("/api/admin/email/templates/:id", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const name = String(req.body.name || "").trim();
      const eventKey = String(req.body.event_key || "general").trim().toLowerCase();
      const subject = String(req.body.subject || "").trim();
      const body = String(req.body.body || "");
      const active = req.body.active === false ? 0 : 1;

      if (!Number.isInteger(id) || id < 1 || !name || !eventKey || !subject || !body) {
        return res.status(400).json({ error: "Datos de plantilla inválidos." });
      }

      const [result] = await pool.query(
        "UPDATE email_templates SET name=?,event_key=?,subject=?,body=?,active=? WHERE id=?",
        [name,eventKey,subject,body,active,id]
      );

      if (!result.affectedRows) return res.status(404).json({ error: "Plantilla no encontrada." });
      res.json({ ok: true });
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "Ya existe otra plantilla con ese nombre y evento." });
      }
      console.error("Error actualizando plantilla de email:", error);
      res.status(500).json({ error: "No se pudo actualizar la plantilla." });
    }
  });

  app.delete("/api/admin/email/templates/:id", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "ID inválido." });
      }

      const [result] = await pool.query("DELETE FROM email_templates WHERE id=?", [id]);
      if (!result.affectedRows) return res.status(404).json({ error: "Plantilla no encontrada." });
      res.json({ ok: true });
    } catch (error) {
      console.error("Error eliminando plantilla de email:", error);
      res.status(500).json({ error: "No se pudo eliminar la plantilla." });
    }
  });

  app.get("/api/admin/email/history", requireAdmin, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT id,event_key,recipient_name,recipient_email,subject,status,error_message,sent_at,created_at
         FROM email_messages ORDER BY id DESC LIMIT 200`
      );
      res.json({ messages: rows });
    } catch (error) {
      console.error("Error obteniendo historial de email:", error);
      res.status(500).json({ error: "No se pudo obtener el historial." });
    }
  });

  app.post("/api/admin/email/prepare", requireAdmin, async (req, res) => {
    try {
      const templateId = Number(req.body.template_id);
      const recipientName = String(req.body.recipient_name || "").trim();
      const recipientEmail = normalizeEmail(req.body.recipient_email);
      const variables = req.body.variables && typeof req.body.variables === "object" ? req.body.variables : {};
      const targetType = String(req.body.target_type || "").trim();
      const targetId = req.body.target_id ? Number(req.body.target_id) : null;

      if (!Number.isInteger(templateId) || templateId < 1 || !validateEmail(recipientEmail)) {
        return res.status(400).json({ error: "Plantilla o correo electrónico inválido." });
      }

      const [rows] = await pool.query(
        "SELECT id,event_key,subject,body FROM email_templates WHERE id=? AND active=1 LIMIT 1",
        [templateId]
      );
      if (!rows.length) return res.status(404).json({ error: "Plantilla no encontrada o inactiva." });

      const template = rows[0];
      const subject = renderTemplate(template.subject, variables);
      const body = renderTemplate(template.body, variables);

      const id = await createEmailMessage(pool, {
        template_id: template.id,
        event_key: template.event_key,
        recipient_name: recipientName,
        recipient_email: recipientEmail,
        subject,
        body,
        target_type: targetType,
        target_id: targetId
      });

      res.status(201).json({ ok: true, id, subject, body });
    } catch (error) {
      console.error("Error preparando email:", error);
      res.status(500).json({ error: "No se pudo preparar el correo." });
    }
  });

  app.post("/api/admin/email/:id/send", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "ID inválido." });

      const result = await sendStoredEmail(id);
      res.json(result);
    } catch (error) {
      console.error("Error enviando email:", error);
      res.status(500).json({ error: error.message || "No se pudo enviar el correo." });
    }
  });
}

module.exports = registerEmailRoutes;
