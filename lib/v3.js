const V3_VERSION = "3.0.0";
const V3_API_PREFIX = "/api/v3";
const { rateLimit } = require("express-rate-limit");

function v3Metadata() {
  return {
    version: V3_VERSION,
    api: V3_API_PREFIX,
    status: "development",
    architecture: "modular-monolith",
    database: "mysql",
    compatibility: { legacyApi: "/api", v3Api: V3_API_PREFIX }
  };
}

function v3SecurityHeaders(res) {
  res.setHeader("X-JR-API-Version", V3_VERSION);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
}

function clean(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function validEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function dateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function timeOnly(value) {
  return /^\d{2}:\d{2}$/.test(value);
}

async function safeCount(pool, table, where = "") {
  try {
    const [rows] = await pool.query("SELECT COUNT(*) AS total FROM " + table + (where ? " WHERE " + where : ""));
    return Number(rows[0]?.total || 0);
  } catch {
    return 0;
  }
}



async function v3Columns(pool, table) {
  const [rows] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
    [table]
  );
  return new Set(rows.map(row => row.COLUMN_NAME));
}

async function v3EnsureClient(pool, user) {
  const [existing] = await pool.query(
    "SELECT id FROM clients WHERE user_id=? OR LOWER(email)=LOWER(?) OR phone=? ORDER BY user_id=? DESC,id ASC LIMIT 1",
    [user.id, user.email, user.phone || "", user.id]
  );
  if (existing.length) {
    await pool.query(
      "UPDATE clients SET user_id=?,name=?,email=?,phone=COALESCE(NULLIF(?,''),phone),updated_at=NOW() WHERE id=?",
      [user.id, user.name, user.email, user.phone || "", existing[0].id]
    ).catch(() => {});
    return existing[0].id;
  }
  const [result] = await pool.query(
    "INSERT INTO clients (user_id,name,phone,email) VALUES (?,?,?,?)",
    [user.id, user.name, user.phone || "SIN-TELEFONO-" + user.id, user.email]
  );
  return result.insertId;
}

function v3RequireUser(req, res) {
  if (!req.session?.user?.id) {
    res.status(401).json({ error: "Debes iniciar sesión para acceder al portal." });
    return null;
  }
  return Number(req.session.user.id);
}

async function v3User(pool, userId) {
  const [rows] = await pool.query(
    "SELECT id,name,email,role,avatar_url,email_verified_at FROM users WHERE id=? LIMIT 1",
    [userId]
  );
  return rows[0] || null;
}

async function v3Link(pool, userId, entityType, entityId) {
  await pool.query(
    "INSERT IGNORE INTO v3_client_links (user_id,entity_type,entity_id) VALUES (?,?,?)",
    [userId, entityType, entityId]
  );
}

async function v3Notify(pool, userId, title, message, kind = "info") {
  await pool.query(
    "INSERT INTO v3_client_notifications (user_id,title,message,kind) VALUES (?,?,?,?)",
    [userId, title, message, kind]
  );
}

function createV3Router(express, pool) {
  const router = express.Router();
  const publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false
  });

  router.use(express.json({ limit: "100kb" }));
  router.use((req, res, next) => {
    v3SecurityHeaders(res);
    req.apiVersion = V3_VERSION;
    next();
  });

  router.get("/health", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true, service: "jr-electricidad", api: V3_API_PREFIX, version: V3_VERSION });
    } catch {
      res.status(503).json({ ok: false, service: "jr-electricidad", api: V3_API_PREFIX, version: V3_VERSION });
    }
  });

  router.get("/meta", (req, res) => res.json(v3Metadata()));

  router.get("/public/home", async (req, res) => {
    try {
      const [[settings]] = await pool.query(
        "SELECT business_name,legal_name,phone,whatsapp,email,address,city,hours,logo_url FROM business_settings WHERE id=1 LIMIT 1"
      );
      const [services] = await pool.query(
        "SELECT id,title,description,price FROM services WHERE active=1 ORDER BY id ASC"
      );
      const [gallery] = await pool.query(
        "SELECT id,title,description,image_url,alt_text,category,featured,sort_order,created_at FROM gallery WHERE active=1 ORDER BY featured DESC,sort_order ASC,created_at DESC LIMIT 12"
      );
      let testimonials = [];
      try {
        const [rows] = await pool.query(
          "SELECT id,client_name,client_location,rating,message,featured,created_at FROM v3_testimonials WHERE approved=1 ORDER BY featured DESC,created_at DESC LIMIT 8"
        );
        testimonials = rows;
      } catch {}
      const stats = {
        services: services.length,
        works: await safeCount(pool, "gallery", "active=1"),
        clients: await safeCount(pool, "clients"),
        completedJobs: await safeCount(pool, "jobs", "status IN ('completed','finalizado','finished')")
      };
      res.json({ ok: true, version: V3_VERSION, settings: settings || null, services, gallery, testimonials, stats });
    } catch (error) {
      res.status(500).json({ ok: false, error: "No se pudo cargar el contenido público V3." });
    }
  });

  router.get("/public/availability", publicLimiter, async (req, res) => {
    const date = clean(req.query.date, 10);
    if (!dateOnly(date)) return res.status(400).json({ error: "La fecha no es válida." });
    try {
      const [[cfg]] = await pool.query(
        "SELECT appointment_enabled,appointment_start_hour,appointment_end_hour,appointment_slot_minutes FROM v3_system WHERE id=1 LIMIT 1"
      );
      if (!cfg?.appointment_enabled) return res.json({ enabled: false, date, slots: [] });
      const day = new Date(date + "T12:00:00");
      if (Number.isNaN(day.getTime()) || day.getDay() === 0) return res.json({ enabled: true, date, slots: [] });
      const [booked] = await pool.query(
        "SELECT TIME_FORMAT(start_time,'%H:%i') AS start_time FROM v3_appointments WHERE appointment_date=? AND status IN ('pending','confirmed')",
        [date]
      );
      const taken = new Set(booked.map(row => row.start_time));
      const slots = [];
      const start = Number(cfg.appointment_start_hour);
      const end = Number(cfg.appointment_end_hour);
      const minutes = Math.max(30, Number(cfg.appointment_slot_minutes) || 60);
      for (let m = start * 60; m + minutes <= end * 60; m += minutes) {
        const h = String(Math.floor(m / 60)).padStart(2, "0");
        const min = String(m % 60).padStart(2, "0");
        const value = h + ":" + min;
        if (!taken.has(value)) slots.push(value);
      }
      res.json({ enabled: true, date, slots });
    } catch {
      res.status(500).json({ error: "No se pudo consultar la agenda." });
    }
  });

  router.post("/public/appointments", publicLimiter, async (req, res) => {
    const origin = req.get("origin");
    const host = req.get("host");
    if (origin && origin !== "https://" + host && origin !== "http://" + host) {
      return res.status(403).json({ error: "Origen no permitido." });
    }
    const name = clean(req.body.name, 120);
    const phone = clean(req.body.phone, 50);
    const email = clean(req.body.email, 190).toLowerCase();
    const service = clean(req.body.service, 150);
    const notes = clean(req.body.notes, 1000);
    const appointmentDate = clean(req.body.appointment_date, 10);
    const startTime = clean(req.body.start_time, 5);

    if (!name || !phone || !dateOnly(appointmentDate) || !timeOnly(startTime)) {
      return res.status(400).json({ error: "Completá nombre, teléfono, fecha y horario." });
    }
    if (!validEmail(email)) return res.status(400).json({ error: "El email no es válido." });

    const requested = new Date(appointmentDate + "T" + startTime + ":00");
    const now = new Date();
    if (Number.isNaN(requested.getTime()) || requested < new Date(now.getTime() - 60000)) {
      return res.status(400).json({ error: "El turno debe ser futuro." });
    }

    const day = new Date(appointmentDate + "T12:00:00");
    if (day.getDay() === 0) return res.status(400).json({ error: "No hay atención los domingos." });

    const [[cfg]] = await pool.query(
      "SELECT appointment_enabled,appointment_start_hour,appointment_end_hour,appointment_slot_minutes FROM v3_system WHERE id=1 LIMIT 1"
    );
    if (!cfg?.appointment_enabled) return res.status(409).json({ error: "La agenda online está temporalmente deshabilitada." });

    const [hours, minutesPart] = startTime.split(":").map(Number);
    const startMinutes = hours * 60 + minutesPart;
    const duration = Math.max(30, Number(cfg.appointment_slot_minutes) || 60);
    const startLimit = Number(cfg.appointment_start_hour) * 60;
    const endLimit = Number(cfg.appointment_end_hour) * 60;
    if (startMinutes < startLimit || startMinutes + duration > endLimit || startMinutes % duration !== startLimit % duration) {
      return res.status(400).json({ error: "Ese horario no está disponible." });
    }

    const endMinutes = startMinutes + duration;
    const endTime = String(Math.floor(endMinutes / 60)).padStart(2, "0") + ":" + String(endMinutes % 60).padStart(2, "0");

    try {
      const [existing] = await pool.query(
        "SELECT id FROM v3_appointments WHERE appointment_date=? AND start_time=? AND status IN ('pending','confirmed') LIMIT 1",
        [appointmentDate, startTime]
      );
      if (existing.length) return res.status(409).json({ error: "Ese horario acaba de ser reservado. Elegí otro." });

      const [result] = await pool.query(
        "INSERT INTO v3_appointments (name,phone,email,service,notes,appointment_date,start_time,end_time) VALUES (?,?,?,?,?,?,?,?)",
        [name, phone, email || null, service || null, notes || null, appointmentDate, startTime, endTime]
      );
      res.status(201).json({ ok: true, appointment_id: result.insertId, message: "Solicitud de turno enviada. Te contactaremos para confirmarla." });
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Ese horario ya fue solicitado." });
      res.status(500).json({ error: "No se pudo registrar el turno." });
    }
  });

  // =========================================================
  // V3 — PORTAL CLIENTE
  // =========================================================

  router.get("/client/overview", async (req, res) => {
    const userId = v3RequireUser(req, res);
    if (!userId) return;
    try {
      const user = await v3User(pool, userId);
      if (!user) return res.status(401).json({ error: "La sesión ya no es válida." });
      const [[profile]] = await pool.query(
        "SELECT phone,whatsapp,address,locality,notes FROM v3_client_profiles WHERE user_id=? LIMIT 1",
        [userId]
      );
      const [requests] = await pool.query(
        \`SELECT l.entity_id AS id,qr.name,qr.service,qr.description,qr.status,qr.priority,qr.scheduled_at,qr.created_at
         FROM v3_client_links l JOIN quote_requests qr ON qr.id=l.entity_id
         WHERE l.user_id=? AND l.entity_type='request' ORDER BY qr.created_at DESC LIMIT 8\`,
        [userId]
      );
      const [quotes] = await pool.query(
        \`SELECT l.entity_id AS id,q.status,q.subtotal,q.tax,q.total,q.valid_until,q.notes,q.sent_at,q.accepted_at,q.rejected_at,q.viewed_at,q.created_at
         FROM v3_client_links l JOIN quotes q ON q.id=l.entity_id
         WHERE l.user_id=? AND l.entity_type='quote' ORDER BY q.created_at DESC LIMIT 8\`,
        [userId]
      );
      const [jobs] = await pool.query(
        \`SELECT l.entity_id AS id,j.status,j.scheduled_at,j.location,j.created_at
         FROM v3_client_links l JOIN jobs j ON j.id=l.entity_id
         WHERE l.user_id=? AND l.entity_type='job' ORDER BY COALESCE(j.scheduled_at,j.created_at) DESC LIMIT 8\`,
        [userId]
      );
      const [notifications] = await pool.query(
        "SELECT id,title,message,kind,read_at,created_at FROM v3_client_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 8",
        [userId]
      );
      res.json({
        ok: true, user, profile: profile || null,
        counts: {
          requests: await safeCount(pool, "v3_client_links", "user_id=" + userId + " AND entity_type='request'"),
          quotes: await safeCount(pool, "v3_client_links", "user_id=" + userId + " AND entity_type='quote'"),
          jobs: await safeCount(pool, "v3_client_links", "user_id=" + userId + " AND entity_type='job'"),
          documents: await safeCount(pool, "v3_client_links", "user_id=" + userId + " AND entity_type='document'")
        },
        requests, quotes, jobs, notifications
      });
    } catch (error) {
      console.error("V3 portal overview:", error);
      res.status(500).json({ error: "No se pudo cargar el portal del cliente." });
    }
  });

  router.get("/client/profile", async (req, res) => {
    const userId = v3RequireUser(req, res);
    if (!userId) return;
    try {
      const user = await v3User(pool, userId);
      const [[profile]] = await pool.query(
        "SELECT phone,whatsapp,address,locality,notes FROM v3_client_profiles WHERE user_id=? LIMIT 1",
        [userId]
      );
      res.json({ ok: true, user, profile: profile || {} });
    } catch {
      res.status(500).json({ error: "No se pudo cargar el perfil." });
    }
  });

  router.put("/client/profile", async (req, res) => {
    const userId = v3RequireUser(req, res);
    if (!userId) return;
    const name = clean(req.body.name, 150);
    const phone = clean(req.body.phone, 50);
    const whatsapp = clean(req.body.whatsapp, 50);
    const address = clean(req.body.address, 255);
    const locality = clean(req.body.locality, 120);
    const notes = clean(req.body.notes, 1000);
    if (!name) return res.status(400).json({ error: "El nombre es obligatorio." });
    try {
      const user = await v3User(pool, userId);
      await pool.query("UPDATE users SET name=? WHERE id=?", [name, userId]);
      await pool.query(
        \`INSERT INTO v3_client_profiles (user_id,phone,whatsapp,address,locality,notes)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE phone=VALUES(phone),whatsapp=VALUES(whatsapp),address=VALUES(address),locality=VALUES(locality),notes=VALUES(notes),updated_at=NOW()\`,
        [userId, phone || null, whatsapp || null, address || null, locality || null, notes || null]
      );
      await v3EnsureClient(pool, { ...user, id: userId, name, phone });
      await v3Notify(pool, userId, "Perfil actualizado", "Tus datos personales fueron actualizados.", "account");
      res.json({ ok: true, user: await v3User(pool, userId) });
    } catch (error) {
      console.error("V3 portal profile:", error);
      res.status(500).json({ error: "No se pudo actualizar el perfil." });
    }
  });

  router.get("/client/requests", async (req, res) => {
    const userId = v3RequireUser(req, res);
    if (!userId) return;
    try {
      const [rows] = await pool.query(
        \`SELECT l.entity_id AS id,qr.name,qr.phone,qr.email,qr.service,qr.description,qr.preferred_date,qr.status,qr.priority,qr.scheduled_at,qr.created_at,qr.updated_at
         FROM v3_client_links l JOIN quote_requests qr ON qr.id=l.entity_id
         WHERE l.user_id=? AND l.entity_type='request' ORDER BY qr.created_at DESC\`,
        [userId]
      );
      res.json({ ok: true, requests: rows });
    } catch {
      res.status(500).json({ error: "No se pudieron cargar las solicitudes." });
    }
  });

  router.post("/client/requests", publicLimiter, async (req, res) => {
    const userId = v3RequireUser(req, res);
    if (!userId) return;
    const service = clean(req.body.service, 150);
    const description = clean(req.body.description, 3000);
    const preferredDate = clean(req.body.preferred_date, 10);
    if (!service || !description) return res.status(400).json({ error: "Indicá servicio y descripción." });
    try {
      const user = await v3User(pool, userId);
      const [[profile]] = await pool.query("SELECT phone FROM v3_client_profiles WHERE user_id=? LIMIT 1",[userId]);
      const clientId = await v3EnsureClient(pool, { ...user, phone: profile?.phone || "" });
      const [result] = await pool.query(
        \`INSERT INTO quote_requests (name,phone,email,service,description,preferred_date,status,priority,client_id,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,NOW())\`,
        [user.name, profile?.phone || "SIN-TELEFONO-" + userId, user.email, service, description, preferredDate || null, "nueva", "normal", clientId]
      );
      await v3Link(pool, userId, "request", result.insertId);
      await v3Notify(pool, userId, "Solicitud enviada", "Recibimos tu solicitud de presupuesto y te contactaremos.", "request");
      res.status(201).json({ ok: true, request_id: result.insertId });
    } catch (error) {
      console.error("V3 portal request:", error);
      res.status(500).json({ error: "No se pudo registrar la solicitud. Verificá que las migraciones V2 estén aplicadas." });
    }
  });

  router.get("/client/quotes", async (req, res) => {
    const userId = v3RequireUser(req, res);
    if (!userId) return;
    try {
      const [rows] = await pool.query(
        \`SELECT l.entity_id AS id,q.status,q.subtotal,q.tax,q.total,q.valid_until,q.notes,q.sent_at,q.accepted_at,q.rejected_at,q.viewed_at,q.created_at
         FROM v3_client_links l JOIN quotes q ON q.id=l.entity_id
         WHERE l.user_id=? AND l.entity_type='quote' ORDER BY q.created_at DESC\`,
        [userId]
      );
      res.json({ ok: true, quotes: rows });
    } catch {
      res.status(500).json({ error: "No se pudieron cargar los presupuestos." });
    }
  });

  router.post("/client/quotes/:id/decision", async (req, res) => {
    const userId = v3RequireUser(req, res);
    if (!userId) return;
    const quoteId = Number(req.params.id);
    const decision = clean(req.body.decision, 20);
    const note = clean(req.body.note, 1000);
    if (!Number.isInteger(quoteId) || !["aceptado","rechazado"].includes(decision)) return res.status(400).json({ error: "Decisión no válida." });
    try {
      const [linked] = await pool.query(
        "SELECT entity_id FROM v3_client_links WHERE user_id=? AND entity_type='quote' AND entity_id=? LIMIT 1",
        [userId, quoteId]
      );
      if (!linked.length) return res.status(404).json({ error: "Presupuesto no encontrado." });
      const user = await v3User(pool, userId);
      const [[profile]] = await pool.query("SELECT phone FROM v3_client_profiles WHERE user_id=? LIMIT 1",[userId]);
      await pool.query(
        \`INSERT INTO quote_acceptances (quote_id,decision,customer_name,customer_email,customer_phone,customer_note,consent_text,signature_name,ip_address,user_agent)
         VALUES (?,?,?,?,?,?,?,?,?,?)\`,
        [quoteId, decision, user.name, user.email, profile?.phone || "SIN-TELEFONO", note || null, "El cliente declara que la decisión corresponde al presupuesto visualizado.", user.name, req.ip || null, clean(req.get("user-agent"),512)]
      );
      if (decision === "aceptado") {
        await pool.query("UPDATE quotes SET status='aceptado',accepted_at=NOW() WHERE id=?", [quoteId]);
      } else {
        await pool.query("UPDATE quotes SET status='rechazado',rejected_at=NOW() WHERE id=?", [quoteId]);
      }
      await v3Notify(pool, userId, decision === "aceptado" ? "Presupuesto aceptado" : "Presupuesto rechazado", "Registramos tu decisión sobre el presupuesto #" + quoteId + ".", "quote");
      res.json({ ok: true, message: decision === "aceptado" ? "Presupuesto aceptado." : "Presupuesto rechazado." });
    } catch (error) {
      console.error("V3 quote decision:", error);
      res.status(500).json({ error: "No se pudo registrar la decisión." });
    }
  });

  router.get("/client/jobs", async (req, res) => {
    const userId = v3RequireUser(req, res);
    if (!userId) return;
    try {
      const [rows] = await pool.query(
        \`SELECT l.entity_id AS id,j.status,j.scheduled_at,j.location,j.execution_notes,j.completion_notes,j.created_at
         FROM v3_client_links l JOIN jobs j ON j.id=l.entity_id
         WHERE l.user_id=? AND l.entity_type='job' ORDER BY COALESCE(j.scheduled_at,j.created_at) DESC\`,
        [userId]
      );
      res.json({ ok: true, jobs: rows });
    } catch {
      res.status(500).json({ error: "No se pudieron cargar los trabajos." });
    }
  });

  router.get("/client/documents", async (req, res) => {
    const userId = v3RequireUser(req, res);
    if (!userId) return;
    try {
      const [rows] = await pool.query(
        \`SELECT d.id,d.document_type,d.title,d.description,d.current_version,d.created_at,d.updated_at
         FROM v3_client_links l JOIN documents d ON d.id=l.entity_id
         WHERE l.user_id=? AND l.entity_type='document' ORDER BY d.updated_at DESC\`,
        [userId]
      );
      res.json({ ok: true, documents: rows });
    } catch {
      res.status(500).json({ error: "No se pudieron cargar los documentos." });
    }
  });

  router.get("/client/activity", async (req, res) => {
    const userId = v3RequireUser(req, res);
    if (!userId) return;
    try {
      const [rows] = await pool.query(
        \`SELECT id,action,entity_type,entity_id,created_at,metadata
         FROM audit_log WHERE actor_user_id=? ORDER BY created_at DESC LIMIT 50\`,
        [userId]
      );
      res.json({ ok: true, activity: rows });
    } catch {
      res.status(500).json({ error: "No se pudo cargar la actividad." });
    }
  });

  router.get("/client/notifications", async (req, res) => {
    const userId = v3RequireUser(req, res);
    if (!userId) return;
    try {
      const [rows] = await pool.query(
        "SELECT id,title,message,kind,read_at,created_at FROM v3_client_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
        [userId]
      );
      res.json({ ok: true, notifications: rows });
    } catch {
      res.status(500).json({ error: "No se pudieron cargar las notificaciones." });
    }
  });

  router.post("/client/notifications/:id/read", async (req, res) => {
    const userId = v3RequireUser(req, res);
    if (!userId) return;
    try {
      const [result] = await pool.query(
        "UPDATE v3_client_notifications SET read_at=NOW() WHERE id=? AND user_id=?",
        [Number(req.params.id), userId]
      );
      if (!result.affectedRows) return res.status(404).json({ error: "Notificación no encontrada." });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "No se pudo actualizar la notificación." });
    }
  });

  return router;
}

module.exports = { V3_VERSION, V3_API_PREFIX, v3Metadata, v3SecurityHeaders, createV3Router };