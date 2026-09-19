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



async function v3SyncLinks(pool, userId, clientId) {
  try {
    const [requests] = await pool.query("SELECT id FROM quote_requests WHERE client_id=?", [clientId]);
    for (const row of requests) await v3Link(pool, userId, "request", row.id);
    const requestIds = requests.map(row => row.id);
    if (requestIds.length) {
      const [quotes] = await pool.query(
        "SELECT id FROM quotes WHERE quote_request_id IN (" + requestIds.map(() => "?").join(",") + ")",
        requestIds
      );
      for (const row of quotes) await v3Link(pool, userId, "quote", row.id);
      const quoteIds = quotes.map(row => row.id);
      if (quoteIds.length) {
        const [jobs] = await pool.query(
          "SELECT id FROM jobs WHERE quote_id IN (" + quoteIds.map(() => "?").join(",") + ")",
          quoteIds
        ).catch(() => [[]]);
        for (const row of jobs) await v3Link(pool, userId, "job", row.id);
        const [docs] = await pool.query(
          "SELECT id FROM documents WHERE quote_id IN (" + quoteIds.map(() => "?").join(",") + ")",
          quoteIds
        ).catch(() => [[]]);
        for (const row of docs) await v3Link(pool, userId, "document", row.id);
      }
    }
    const [documents] = await pool.query("SELECT id FROM documents WHERE client_id=?", [clientId]).catch(() => [[]]);
    for (const row of documents) await v3Link(pool, userId, "document", row.id);
    const jobCols = await v3Columns(pool, "jobs");
    if (jobCols.has("client_id")) {
      const [jobs] = await pool.query("SELECT id FROM jobs WHERE client_id=?", [clientId]);
      for (const row of jobs) await v3Link(pool, userId, "job", row.id);
    }
  } catch (error) {
    console.error("V3 portal link sync:", error.message);
  }
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
        `SELECT l.entity_id AS id,qr.name,qr.service,qr.description,qr.status,qr.priority,qr.scheduled_at,qr.created_at
         FROM v3_client_links l JOIN quote_requests qr ON qr.id=l.entity_id
         WHERE l.user_id=? AND l.entity_type='request' ORDER BY qr.created_at DESC LIMIT 8`,
        [userId]
      );
      const [quotes] = await pool.query(
        `SELECT l.entity_id AS id,q.status,q.total,q.issue_date,q.expiration_date,q.notes,q.sent_at,q.accepted_at,q.rejected_at,q.viewed_at,q.created_at
         FROM v3_client_links l JOIN quotes q ON q.id=l.entity_id
         WHERE l.user_id=? AND l.entity_type='quote' ORDER BY q.created_at DESC LIMIT 8`,
        [userId]
      );
      const [jobs] = await pool.query(
        `SELECT l.entity_id AS id,j.status,j.scheduled_at,j.location,j.created_at
         FROM v3_client_links l JOIN jobs j ON j.id=l.entity_id
         WHERE l.user_id=? AND l.entity_type='job' ORDER BY COALESCE(j.scheduled_at,j.created_at) DESC LIMIT 8`,
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
        `INSERT INTO v3_client_profiles (user_id,phone,whatsapp,address,locality,notes)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE phone=VALUES(phone),whatsapp=VALUES(whatsapp),address=VALUES(address),locality=VALUES(locality),notes=VALUES(notes),updated_at=NOW()`,
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
        `SELECT l.entity_id AS id,qr.name,qr.phone,qr.email,qr.service,qr.description,qr.preferred_date,qr.status,qr.priority,qr.scheduled_at,qr.created_at,qr.updated_at
         FROM v3_client_links l JOIN quote_requests qr ON qr.id=l.entity_id
         WHERE l.user_id=? AND l.entity_type='request' ORDER BY qr.created_at DESC`,
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
        `INSERT INTO quote_requests (name,phone,email,service,description,preferred_date,status,priority,client_id,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,NOW())`,
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
        `SELECT l.entity_id AS id,q.status,q.subtotal,q.discount,q.tax_rate,q.tax_amount,q.total,q.expiration_date,q.notes,q.sent_at,q.accepted_at,q.rejected_at,q.viewed_at,q.created_at
         FROM v3_client_links l JOIN quotes q ON q.id=l.entity_id
         WHERE l.user_id=? AND l.entity_type='quote' ORDER BY q.created_at DESC`,
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
      const [[quote]] = await pool.query("SELECT status FROM quotes WHERE id=? LIMIT 1",[quoteId]);
      if (!quote) return res.status(404).json({ error: "Presupuesto no encontrado." });
      if (["aceptado","rechazado"].includes(String(quote.status))) {
        return res.status(409).json({ error: "Este presupuesto ya tiene una decisión registrada." });
      }
      const user = await v3User(pool, userId);
      const [[profile]] = await pool.query("SELECT phone FROM v3_client_profiles WHERE user_id=? LIMIT 1",[userId]);
      await pool.query(
        `INSERT INTO quote_acceptances (quote_id,decision,customer_name,customer_email,customer_phone,customer_note,consent_text,signature_name,ip_address,user_agent)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
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
        `SELECT l.entity_id AS id,j.status,j.scheduled_at,j.location,j.execution_notes,j.completion_notes,j.created_at
         FROM v3_client_links l JOIN jobs j ON j.id=l.entity_id
         WHERE l.user_id=? AND l.entity_type='job' ORDER BY COALESCE(j.scheduled_at,j.created_at) DESC`,
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
        `SELECT d.id,d.document_type,d.title,d.description,d.current_version,d.created_at,d.updated_at
         FROM v3_client_links l JOIN documents d ON d.id=l.entity_id
         WHERE l.user_id=? AND l.entity_type='document' ORDER BY d.updated_at DESC`,
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
        `SELECT id,action,entity_type,entity_id,created_at,metadata
         FROM audit_log WHERE actor_user_id=? ORDER BY created_at DESC LIMIT 50`,
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


  // =========================================================
  // V3 — BLOQUE D: AGENDA Y TURNOS
  // =========================================================

  function v3Admin(req, res) {
    if (!req.session?.user?.id || req.session.user.role !== "admin") {
      res.status(403).json({ error: "Acceso exclusivo para administradores." });
      return false;
    }
    return true;
  }

  async function v3AppointmentOwner(pool, appointmentId, userId) {
    const [rows] = await pool.query(
      "SELECT id,appointment_date,start_time,end_time,status,user_id,client_id,name,phone,email,service,notes FROM v3_appointments WHERE id=? AND user_id=? LIMIT 1",
      [appointmentId, userId]
    );
    return rows[0] || null;
  }

  router.get("/client/appointments", async (req, res) => {
    const userId = v3RequireUser(req, res);
    if (!userId) return;
    try {
      const [rows] = await pool.query(
        "SELECT id,name,phone,email,service,notes,appointment_date,start_time,end_time,status,confirmed_at,cancelled_at,created_at,updated_at FROM v3_appointments WHERE user_id=? ORDER BY appointment_date DESC,start_time DESC LIMIT 50",
        [userId]
      );
      res.json({ ok: true, appointments: rows });
    } catch {
      res.status(500).json({ error: "No se pudieron cargar tus turnos." });
    }
  });

  router.post("/client/appointments", publicLimiter, async (req, res) => {
    const userId = v3RequireUser(req, res);
    if (!userId) return;
    const service = clean(req.body.service, 150);
    const notes = clean(req.body.notes, 1000);
    const appointmentDate = clean(req.body.appointment_date, 10);
    const startTime = clean(req.body.start_time, 5);
    if (!dateOnly(appointmentDate) || !timeOnly(startTime)) {
      return res.status(400).json({ error: "Fecha u horario inválido." });
    }
    try {
      const user = await v3User(pool, userId);
      const [[profile]] = await pool.query("SELECT phone,whatsapp FROM v3_client_profiles WHERE user_id=? LIMIT 1", [userId]);
      const phone = profile?.whatsapp || profile?.phone || "";
      if (!phone) return res.status(400).json({ error: "Agregá un teléfono o WhatsApp en tu perfil antes de reservar." });

      const [[cfg]] = await pool.query("SELECT appointment_enabled,appointment_start_hour,appointment_end_hour,appointment_slot_minutes FROM v3_system WHERE id=1 LIMIT 1");
      if (!cfg?.appointment_enabled) return res.status(409).json({ error: "La agenda está temporalmente deshabilitada." });

      const day = new Date(appointmentDate + "T12:00:00");
      if (day.getDay() === 0) return res.status(400).json({ error: "No hay atención los domingos." });

      const [hours, mins] = startTime.split(":").map(Number);
      const startMinutes = hours * 60 + mins;
      const duration = Math.max(30, Number(cfg.appointment_slot_minutes) || 60);
      const startLimit = Number(cfg.appointment_start_hour) * 60;
      const endLimit = Number(cfg.appointment_end_hour) * 60;
      if (startMinutes < startLimit || startMinutes + duration > endLimit || startMinutes % duration !== startLimit % duration) {
        return res.status(400).json({ error: "Ese horario no está disponible." });
      }
      const [existing] = await pool.query(
        "SELECT id FROM v3_appointments WHERE appointment_date=? AND start_time=? AND status IN ('pending','confirmed') LIMIT 1",
        [appointmentDate, startTime]
      );
      if (existing.length) return res.status(409).json({ error: "Ese horario ya está reservado." });

      const clientId = await v3EnsureClient(pool, { id:user.id, name:user.name, email:user.email, phone });
      const endMinutes = startMinutes + duration;
      const endTime = String(Math.floor(endMinutes/60)).padStart(2,"0")+":"+String(endMinutes%60).padStart(2,"0");
      const [result] = await pool.query(
        "INSERT INTO v3_appointments (user_id,client_id,name,phone,email,service,notes,appointment_date,start_time,end_time,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [userId,clientId,user.name,phone,user.email,service||null,notes||null,appointmentDate,startTime,endTime,"pending"]
      );
      await v3Notify(pool,userId,"Turno solicitado","Recibimos tu solicitud para el "+appointmentDate+" a las "+startTime+".","appointment");
      res.status(201).json({ ok:true, appointment_id:result.insertId, message:"Turno solicitado. Te contactaremos para confirmarlo." });
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") return res.status(409).json({ error:"Ese horario ya fue reservado." });
      res.status(500).json({ error:"No se pudo registrar el turno." });
    }
  });

  router.patch("/client/appointments/:id/cancel", async (req, res) => {
    const userId = v3RequireUser(req, res);
    if (!userId) return;
    const id = Number(req.params.id);
    try {
      const appt = await v3AppointmentOwner(pool,id,userId);
      if (!appt) return res.status(404).json({ error:"Turno no encontrado." });
      if (!["pending","confirmed"].includes(appt.status)) return res.status(409).json({ error:"Ese turno ya no puede cancelarse." });
      await pool.query("UPDATE v3_appointments SET status='cancelled',cancelled_at=NOW(),cancellation_reason=? WHERE id=? AND user_id=?",[clean(req.body.reason,500)||"Cancelado por el cliente",id,userId]);
      await v3Notify(pool,userId,"Turno cancelado","El turno #"+id+" fue cancelado.","appointment");
      res.json({ok:true});
    } catch { res.status(500).json({error:"No se pudo cancelar el turno."}); }
  });

  router.patch("/client/appointments/:id/reschedule", publicLimiter, async (req, res) => {
    const userId = v3RequireUser(req, res);
    if (!userId) return;
    const id = Number(req.params.id);
    const date = clean(req.body.appointment_date,10);
    const time = clean(req.body.start_time,5);
    if (!dateOnly(date)||!timeOnly(time)) return res.status(400).json({error:"Nueva fecha u horario inválido."});
    try {
      const appt=await v3AppointmentOwner(pool,id,userId);
      if(!appt) return res.status(404).json({error:"Turno no encontrado."});
      if(!["pending","confirmed"].includes(appt.status)) return res.status(409).json({error:"Ese turno no puede reprogramarse."});
      const [[cfg]]=await pool.query("SELECT appointment_enabled,appointment_start_hour,appointment_end_hour,appointment_slot_minutes FROM v3_system WHERE id=1 LIMIT 1");
      const day=new Date(date+"T12:00:00"); if(day.getDay()===0)return res.status(400).json({error:"No hay atención los domingos."});
      const [h,m]=time.split(":").map(Number), start=h*60+m, duration=Math.max(30,Number(cfg.appointment_slot_minutes)||60), min=Number(cfg.appointment_start_hour)*60, max=Number(cfg.appointment_end_hour)*60;
      if(start<min||start+duration>max||start%duration!==min%duration)return res.status(400).json({error:"Ese horario no está disponible."});
      const [existing]=await pool.query("SELECT id FROM v3_appointments WHERE appointment_date=? AND start_time=? AND status IN ('pending','confirmed') AND id<>? LIMIT 1",[date,time,id]);
      if(existing.length)return res.status(409).json({error:"Ese horario ya está reservado."});
      const end=start+duration, endTime=String(Math.floor(end/60)).padStart(2,"0")+":"+String(end%60).padStart(2,"0");
      await pool.query("UPDATE v3_appointments SET appointment_date=?,start_time=?,end_time=?,status='pending',confirmed_at=NULL,updated_at=NOW() WHERE id=? AND user_id=?",[date,time,endTime,id,userId]);
      await v3Notify(pool,userId,"Turno reprogramado","El turno #"+id+" quedó solicitado para el "+date+" a las "+time+".","appointment");
      res.json({ok:true});
    } catch { res.status(500).json({error:"No se pudo reprogramar el turno."});}
  });

  router.get("/admin/appointments", async (req, res) => {
    if (!v3Admin(req,res)) return;
    const date=clean(req.query.date,10), status=clean(req.query.status,20);
    try {
      const params=[], where=[];
      if(date){if(!dateOnly(date))return res.status(400).json({error:"Fecha inválida."});where.push("a.appointment_date=?");params.push(date);}
      if(status){where.push("a.status=?");params.push(status);}
      const [rows]=await pool.query(
        "SELECT a.*,u.name AS account_name,c.name AS client_name FROM v3_appointments a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN clients c ON c.id=a.client_id "+(where.length?" WHERE "+where.join(" AND "):"")+" ORDER BY a.appointment_date ASC,a.start_time ASC LIMIT 500",params
      );
      res.json({ok:true,appointments:rows});
    } catch { res.status(500).json({error:"No se pudo cargar la agenda."});}
  });

  router.patch("/admin/appointments/:id", async (req,res)=>{
    if(!v3Admin(req,res))return;
    const id=Number(req.params.id), status=clean(req.body.status,20);
    const allowed=["pending","confirmed","cancelled","completed"];
    if(!allowed.includes(status))return res.status(400).json({error:"Estado de turno inválido."});
    try{
      const [[appt]]=await pool.query("SELECT id,user_id,status FROM v3_appointments WHERE id=? LIMIT 1",[id]);
      if(!appt)return res.status(404).json({error:"Turno no encontrado."});
      const fields=["status=?"],params=[status];
      if(status==="confirmed")fields.push("confirmed_at=NOW()");
      if(status==="cancelled")fields.push("cancelled_at=NOW()");
      if(status==="completed")fields.push("completed_at=NOW()");
      await pool.query("UPDATE v3_appointments SET "+fields.join(",")+" WHERE id=?",params.concat(id));
      if(appt.user_id){
        const labels={pending:"pendiente",confirmed:"confirmado",cancelled:"cancelado",completed:"completado"};
        await v3Notify(pool,appt.user_id,"Actualización de turno","Tu turno #"+id+" fue marcado como "+labels[status]+".","appointment");
      }
      res.json({ok:true});
    }catch{res.status(500).json({error:"No se pudo actualizar el turno."});}
  });

  router.patch("/admin/appointments/:id/reschedule", async (req,res)=>{
    if(!v3Admin(req,res))return;
    const id=Number(req.params.id),date=clean(req.body.appointment_date,10),time=clean(req.body.start_time,5);
    if(!dateOnly(date)||!timeOnly(time))return res.status(400).json({error:"Fecha u horario inválido."});
    try{
      const [[cfg]]=await pool.query("SELECT appointment_enabled,appointment_start_hour,appointment_end_hour,appointment_slot_minutes FROM v3_system WHERE id=1 LIMIT 1");
      const [h,m]=time.split(":").map(Number),start=h*60+m,duration=Math.max(30,Number(cfg.appointment_slot_minutes)||60),min=Number(cfg.appointment_start_hour)*60,max=Number(cfg.appointment_end_hour)*60;
      const day=new Date(date+"T12:00:00");if(day.getDay()===0)return res.status(400).json({error:"No hay atención los domingos."});
      if(start<min||start+duration>max||start%duration!==min%duration)return res.status(400).json({error:"Ese horario no está disponible."});
      const [existing]=await pool.query("SELECT id FROM v3_appointments WHERE appointment_date=? AND start_time=? AND status IN ('pending','confirmed') AND id<>? LIMIT 1",[date,time,id]);
      if(existing.length)return res.status(409).json({error:"Ese horario ya está reservado."});
      const end=start+duration,endTime=String(Math.floor(end/60)).padStart(2,"0")+":"+String(end%60).padStart(2,"0");
      const [[appt]]=await pool.query("SELECT user_id FROM v3_appointments WHERE id=? LIMIT 1",[id]);
      if(!appt)return res.status(404).json({error:"Turno no encontrado."});
      await pool.query("UPDATE v3_appointments SET appointment_date=?,start_time=?,end_time=?,status='pending',confirmed_at=NULL WHERE id=?",[date,time,endTime,id]);
      if(appt.user_id)await v3Notify(pool,appt.user_id,"Turno reprogramado","Tu turno #"+id+" fue reprogramado para el "+date+" a las "+time+".","appointment");
      res.json({ok:true});
    }catch{res.status(500).json({error:"No se pudo reprogramar el turno."});}
  });

  router.post("/admin/appointments/reminders", async (req,res)=>{
    if(!v3Admin(req,res))return;
    try{
      const [rows]=await pool.query(
        "SELECT id,user_id,appointment_date,start_time FROM v3_appointments WHERE status='confirmed' AND reminder_sent_at IS NULL AND TIMESTAMP(appointment_date,start_time) BETWEEN NOW() AND DATE_ADD(NOW(),INTERVAL 24 HOUR) LIMIT 100"
      );
      for(const a of rows){
        if(a.user_id)await v3Notify(pool,a.user_id,"Recordatorio de turno","Recordatorio: tenés un turno confirmado para el "+a.appointment_date+" a las "+a.start_time+".","appointment");
        await pool.query("UPDATE v3_appointments SET reminder_sent_at=NOW() WHERE id=?",[a.id]);
      }
      res.json({ok:true,sent:rows.length});
    }catch{res.status(500).json({error:"No se pudieron procesar los recordatorios."});}
  });



  // =========================================================
  // V3 — BLOQUE E: PRESUPUESTOS
  // =========================================================

  async function v3QuoteDetail(quoteId) {
    const [[quote]] = await pool.query(
      `SELECT q.*,qr.name AS client_name,qr.email AS client_email,qr.phone AS client_phone,qr.service AS requested_service
       FROM quotes q JOIN quote_requests qr ON qr.id=q.quote_request_id WHERE q.id=? LIMIT 1`,
      [quoteId]
    );
    if (!quote) return null;
    const [items] = await pool.query("SELECT id,description,quantity,unit,unit_price,total FROM quote_items WHERE quote_id=? ORDER BY id",[quoteId]);
    const [events] = await pool.query("SELECT id,event_type,actor_user_id,metadata,created_at FROM v3_quote_events WHERE quote_id=? ORDER BY created_at DESC LIMIT 100",[quoteId]).catch(()=>[[]]);
    const [versions] = await pool.query("SELECT id,version_no,created_by,created_at FROM v3_quote_versions WHERE quote_id=? ORDER BY version_no DESC",[quoteId]).catch(()=>[[]]);
    return {...quote,items,events,versions};
  }

  async function v3QuoteSnapshot(quoteId) {
    const q=await v3QuoteDetail(quoteId);
    return q ? JSON.parse(JSON.stringify(q)) : null;
  }

  async function v3QuoteEvent(quoteId, actorUserId, type, metadata={}) {
    await pool.query("INSERT INTO v3_quote_events(quote_id,actor_user_id,event_type,metadata) VALUES(?,?,?,?)",[quoteId,actorUserId,type,JSON.stringify(metadata)]);
  }

  async function v3SaveQuoteVersion(quoteId, actorUserId) {
    const snapshot=await v3QuoteSnapshot(quoteId);
    if(!snapshot)return;
    const [[row]]=await pool.query("SELECT COALESCE(MAX(version_no),0)+1 AS next_version FROM v3_quote_versions WHERE quote_id=?",[quoteId]);
    await pool.query("INSERT INTO v3_quote_versions(quote_id,version_no,snapshot,created_by) VALUES(?,?,?,?)",[quoteId,row.next_version,JSON.stringify(snapshot),actorUserId||null]);
    await pool.query("UPDATE quotes SET version_no=? WHERE id=?",[row.next_version,quoteId]);
  }

  router.get("/client/quotes/:id", async (req,res)=>{
    const userId=v3RequireUser(req,res); if(!userId)return;
    const id=Number(req.params.id);
    try{
      const [[link]]=await pool.query("SELECT entity_id FROM v3_client_links WHERE user_id=? AND entity_type='quote' AND entity_id=? LIMIT 1",[userId,id]);
      if(!link)return res.status(404).json({error:"Presupuesto no encontrado."});
      const quote=await v3QuoteDetail(id); if(!quote)return res.status(404).json({error:"Presupuesto no encontrado."});
      if(quote.status==="enviado" && !quote.viewed_at) await pool.query("UPDATE quotes SET viewed_at=NOW() WHERE id=?",[id]);
      res.json({ok:true,quote});
    }catch{res.status(500).json({error:"No se pudo cargar el presupuesto."});}
  });

  router.get("/admin/quotes", async (req,res)=>{
    if(!v3Admin(req,res))return;
    const status=clean(req.query.status,30);
    try{
      const params=[]; let where="";
      if(status){where=" WHERE q.status=?";params.push(status);}
      const [rows]=await pool.query(
        `SELECT q.id,q.quote_number,q.issue_date,q.expiration_date,q.status,q.subtotal,q.discount,q.tax_rate,q.tax_amount,q.total,q.version_no,q.created_at,
         qr.name AS client_name,qr.email AS client_email,qr.service AS requested_service,COUNT(qi.id) AS items_count
         FROM quotes q JOIN quote_requests qr ON qr.id=q.quote_request_id LEFT JOIN quote_items qi ON qi.quote_id=q.id${where}
         GROUP BY q.id,qr.id ORDER BY q.created_at DESC,q.id DESC LIMIT 500`,params);
      res.json({ok:true,quotes:rows});
    }catch{res.status(500).json({error:"No se pudieron cargar los presupuestos V3."});}
  });

  router.get("/admin/quotes/:id", async (req,res)=>{
    if(!v3Admin(req,res))return;
    const q=await v3QuoteDetail(Number(req.params.id));
    if(!q)return res.status(404).json({error:"Presupuesto no encontrado."});
    res.json({ok:true,quote:q});
  });

  router.post("/admin/quotes/:id/recalculate", async(req,res)=>{
    if(!v3Admin(req,res))return;
    const id=Number(req.params.id);
    try{
      const q=await v3QuoteDetail(id);if(!q)return res.status(404).json({error:"Presupuesto no encontrado."});
      const subtotal=q.items.reduce((s,x)=>s+Number(x.total||Number(x.quantity||0)*Number(x.unit_price||0)),0);
      const discount=Math.max(0,Number(req.body.discount??q.discount??0));
      const taxRate=Math.max(0,Number(req.body.tax_rate??q.tax_rate??0));
      const base=Math.max(0,subtotal-discount),taxAmount=+(base*taxRate/100).toFixed(2),total=+(base+taxAmount).toFixed(2);
      await pool.query("UPDATE quotes SET subtotal=?,discount=?,tax_rate=?,tax_amount=?,total=?,updated_at=NOW() WHERE id=?",[subtotal,discount,taxRate,taxAmount,total,id]);
      await v3SaveQuoteVersion(id,req.session.user.id);await v3QuoteEvent(id,req.session.user.id,"recalculated",{subtotal,discount,taxRate,taxAmount,total});
      res.json({ok:true,quote:await v3QuoteDetail(id)});
    }catch(e){res.status(500).json({error:"No se pudo recalcular el presupuesto."});}
  });

  router.post("/admin/quotes/:id/send", async(req,res)=>{
    if(!v3Admin(req,res))return;
    const id=Number(req.params.id);
    try{
      const q=await v3QuoteDetail(id);if(!q)return res.status(404).json({error:"Presupuesto no encontrado."});
      await pool.query("UPDATE quotes SET status='enviado',sent_at=COALESCE(sent_at,NOW()) WHERE id=?",[id]);
      await v3SaveQuoteVersion(id,req.session.user.id);await v3QuoteEvent(id,req.session.user.id,"sent",{version:q.version_no});
      const [[link]]=await pool.query("SELECT user_id FROM v3_client_links WHERE entity_type='quote' AND entity_id=? LIMIT 1",[id]).catch(()=>[[]]);
      if(link?.user_id)await v3Notify(pool,link.user_id,"Nuevo presupuesto","Tenés un nuevo presupuesto para revisar.","quote");
      res.json({ok:true,quote:await v3QuoteDetail(id)});
    }catch{res.status(500).json({error:"No se pudo enviar el presupuesto."});}
  });

  router.get("/admin/quotes/:id/history", async(req,res)=>{
    if(!v3Admin(req,res))return;
    try{
      const [events]=await pool.query("SELECT * FROM v3_quote_events WHERE quote_id=? ORDER BY created_at DESC",[Number(req.params.id)]);
      const [versions]=await pool.query("SELECT id,version_no,created_by,created_at,snapshot FROM v3_quote_versions WHERE quote_id=? ORDER BY version_no DESC",[Number(req.params.id)]);
      res.json({ok:true,events,versions});
    }catch{res.status(500).json({error:"No se pudo cargar el historial."});}
  });

  router.get("/admin/quotes/:id/pdf", async(req,res)=>{
    if(!v3Admin(req,res))return;
    const id=Number(req.params.id);
    try{
      const base=req.protocol+"://"+req.get("host");
      const response=await fetch(base+"/api/admin/quotes/"+id+"/pdf",{headers:{cookie:req.headers.cookie||""}});
      if(!response.ok)return res.status(response.status).json({error:"No se pudo generar el PDF."});
      res.setHeader("Content-Type","application/pdf");
      res.setHeader("Content-Disposition",`inline; filename="presupuesto-${id}.pdf"`);
      res.send(Buffer.from(await response.arrayBuffer()));
    }catch{res.status(500).json({error:"No se pudo generar el PDF V3."});}
  });

  // =========================================================
  // V3 — BLOQUE F: GESTIÓN DE TRABAJOS
  // =========================================================
  async function v3JobDetail(jobId) {
    const [[job]] = await pool.query(`SELECT j.*,q.quote_number,q.issue_date,q.subtotal,q.discount,q.total,qr.name AS client_name,qr.email AS client_email,qr.phone AS client_phone,qr.service AS requested_service,u.name AS assigned_name FROM jobs j JOIN quotes q ON q.id=j.quote_id JOIN quote_requests qr ON qr.id=q.quote_request_id LEFT JOIN users u ON u.id=j.assigned_user_id WHERE j.id=? LIMIT 1`,[jobId]);
    if(!job)return null;
    const [items]=await pool.query("SELECT id,description,quantity,unit,unit_price,total FROM quote_items WHERE quote_id=? ORDER BY id",[job.quote_id]);
    const [tasks]=await pool.query("SELECT * FROM v3_job_tasks WHERE job_id=? ORDER BY sort_order,id",[jobId]).catch(()=>[[]]);
    const [costs]=await pool.query("SELECT * FROM v3_job_costs WHERE job_id=? ORDER BY created_at DESC,id DESC",[jobId]).catch(()=>[[]]);
    const [notes]=await pool.query("SELECT n.*,u.name AS user_name FROM v3_job_notes n LEFT JOIN users u ON u.id=n.user_id WHERE n.job_id=? ORDER BY n.created_at DESC",[jobId]).catch(()=>[[]]);
    const [times]=await pool.query("SELECT t.*,u.name AS user_name FROM v3_job_time_entries t LEFT JOIN users u ON u.id=t.user_id WHERE t.job_id=? ORDER BY t.started_at DESC",[jobId]).catch(()=>[[]]);
    const [events]=await pool.query("SELECT e.*,u.name AS actor_name FROM v3_job_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.job_id=? ORDER BY e.created_at DESC LIMIT 200",[jobId]).catch(()=>[[]]);
    return {...job,items,tasks,costs,notes,times,events};
  }
  async function v3JobEvent(jobId,actor,type,oldStatus=null,newStatus=null,metadata={}){await pool.query("INSERT INTO v3_job_events(job_id,actor_user_id,event_type,old_status,new_status,metadata) VALUES(?,?,?,?,?,?)",[jobId,actor||null,type,oldStatus,newStatus,JSON.stringify(metadata)]);}
  router.get("/admin/jobs",async(req,res)=>{if(!v3Admin(req,res))return;try{const search=clean(req.query.search,150),status=clean(req.query.status,40),assigned=Number(req.query.assigned_user_id||0),where=[],params=[];if(search){where.push("(qr.name LIKE ? OR q.quote_number LIKE ? OR qr.service LIKE ? OR j.work_description LIKE ?)");const s="%"+search+"%";params.push(s,s,s,s);}if(status){where.push("j.status=?");params.push(status);}if(assigned){where.push("j.assigned_user_id=?");params.push(assigned);}const [jobs]=await pool.query(`SELECT j.id,j.quote_id,j.status,j.scheduled_at,j.location,j.work_description,j.started_at,j.completed_at,j.created_at,q.quote_number,q.total,qr.name AS client_name,qr.phone AS client_phone,qr.email AS client_email,qr.service AS requested_service,u.name AS assigned_name FROM jobs j JOIN quotes q ON q.id=j.quote_id JOIN quote_requests qr ON qr.id=q.quote_request_id LEFT JOIN users u ON u.id=j.assigned_user_id ${where.length?"WHERE "+where.join(" AND "):""} ORDER BY COALESCE(j.scheduled_at,j.created_at) DESC,j.id DESC LIMIT 500`,params);res.json({ok:true,jobs});}catch(error){console.error("V3 jobs list:",error);res.status(500).json({error:"No se pudieron cargar los trabajos V3."});}});
  router.get("/admin/jobs/assignees",async(req,res)=>{if(!v3Admin(req,res))return;try{const [users]=await pool.query("SELECT id,name,email FROM users WHERE role='admin' ORDER BY name");res.json({ok:true,users});}catch{res.status(500).json({error:"No se pudieron cargar los técnicos."});}});
  router.post("/admin/jobs",async(req,res)=>{if(!v3Admin(req,res))return;const quoteId=Number(req.body.quote_id),description=clean(req.body.work_description,5000);if(!quoteId)return res.status(400).json({error:"Indicá el presupuesto."});try{const [[quote]]=await pool.query("SELECT id,quote_request_id,status FROM quotes WHERE id=? LIMIT 1",[quoteId]);if(!quote)return res.status(404).json({error:"Presupuesto no encontrado."});const [[existing]]=await pool.query("SELECT id FROM jobs WHERE quote_id=? LIMIT 1",[quoteId]);if(existing)return res.status(409).json({error:"Ese presupuesto ya tiene un trabajo."});const [[qr]]=await pool.query("SELECT client_id,service,description FROM quote_requests WHERE id=? LIMIT 1",[quote.quote_request_id]);const status=quote.status==="aceptado"?"aceptado":"pendiente_presupuesto";const [result]=await pool.query("INSERT INTO jobs(quote_id,status,client_id,work_description,created_at,updated_at) VALUES(?,?,?,?,NOW(),NOW())",[quoteId, status, qr?.client_id||null, description||qr?.description||null]);await v3JobEvent(result.insertId,req.session.user.id,"created",null,status,{quote_id:quoteId});res.status(201).json({ok:true,job:await v3JobDetail(result.insertId)});}catch(error){console.error("V3 create job:",error);res.status(500).json({error:"No se pudo crear el trabajo."});}});
  router.get("/admin/jobs/:id",async(req,res)=>{if(!v3Admin(req,res))return;try{const job=await v3JobDetail(Number(req.params.id));if(!job)return res.status(404).json({error:"Trabajo no encontrado."});res.json({ok:true,job});}catch{res.status(500).json({error:"No se pudo cargar el trabajo."});}});
  router.patch("/admin/jobs/:id",async(req,res)=>{if(!v3Admin(req,res))return;const id=Number(req.params.id),allowed=["assigned_user_id","scheduled_at","location","work_description","internal_notes","execution_notes","estimated_hours"],fields=[],params=[];for(const key of allowed)if(Object.prototype.hasOwnProperty.call(req.body,key)){fields.push(key+"=?");params.push(req.body[key]??null);}if(!fields.length)return res.status(400).json({error:"No hay cambios para guardar."});try{const [[old]]=await pool.query("SELECT id,status FROM jobs WHERE id=?",[id]);if(!old)return res.status(404).json({error:"Trabajo no encontrado."});await pool.query("UPDATE jobs SET "+fields.join(",")+",updated_at=NOW() WHERE id=?",params.concat(id));await v3JobEvent(id,req.session.user.id,"updated",old.status,old.status,{fields});res.json({ok:true,job:await v3JobDetail(id)});}catch{res.status(500).json({error:"No se pudo actualizar el trabajo."});}});
  router.patch("/admin/jobs/:id/status",async(req,res)=>{if(!v3Admin(req,res))return;const id=Number(req.params.id),status=clean(req.body.status,40),allowed=["pendiente_presupuesto","presupuesto_enviado","aceptado","programado","en_proceso","pausado","finalizado","cerrado","rechazado","cancelado"];if(!allowed.includes(status))return res.status(400).json({error:"Estado de trabajo inválido."});try{const [[job]]=await pool.query("SELECT id,status FROM jobs WHERE id=?",[id]);if(!job)return res.status(404).json({error:"Trabajo no encontrado."});const fields=["status=?"],params=[status];if(status==="en_proceso")fields.push("started_at=COALESCE(started_at,NOW())","started_by=?"),params.push(req.session.user.id);if(["finalizado","cerrado"].includes(status))fields.push("completed_at=COALESCE(completed_at,NOW())","completed_by=?"),params.push(req.session.user.id);await pool.query("UPDATE jobs SET "+fields.join(",")+",updated_at=NOW() WHERE id=?",params.concat(id));await v3JobEvent(id,req.session.user.id,"status_changed",job.status,status);res.json({ok:true,job:await v3JobDetail(id)});}catch{res.status(500).json({error:"No se pudo cambiar el estado."});}});
  router.post("/admin/jobs/:id/tasks",async(req,res)=>{if(!v3Admin(req,res))return;const id=Number(req.params.id),title=clean(req.body.title,255);if(!title)return res.status(400).json({error:"El título de la tarea es obligatorio."});try{const [[max]]=await pool.query("SELECT COALESCE(MAX(sort_order),0)+1 n FROM v3_job_tasks WHERE job_id=?",[id]);const [r]=await pool.query("INSERT INTO v3_job_tasks(job_id,title,description,sort_order) VALUES(?,?,?,?)",[id,title,clean(req.body.description,3000)||null,max.n]);await v3JobEvent(id,req.session.user.id,"task_created",null,null,{task_id:r.insertId});res.status(201).json({ok:true});}catch{res.status(500).json({error:"No se pudo crear la tarea."});}});
  router.patch("/admin/jobs/:id/tasks/:taskId",async(req,res)=>{if(!v3Admin(req,res))return;try{const done=!!req.body.completed;await pool.query("UPDATE v3_job_tasks SET completed=?,completed_at=?,completed_by=? WHERE id=? AND job_id=?",[done?1:0,done?new Date():null,done?req.session.user.id:null,Number(req.params.taskId),Number(req.params.id)]);res.json({ok:true});}catch{res.status(500).json({error:"No se pudo actualizar la tarea."});}});
  router.post("/admin/jobs/:id/costs",async(req,res)=>{if(!v3Admin(req,res))return;const kind=clean(req.body.kind,20),description=clean(req.body.description,255),quantity=Number(req.body.quantity||1),unitPrice=Number(req.body.unit_price||0);if(!["material","labor","other"].includes(kind)||!description||quantity<=0||unitPrice<0)return res.status(400).json({error:"Costo inválido."});try{await pool.query("INSERT INTO v3_job_costs(job_id,kind,description,quantity,unit_price,total,created_by) VALUES(?,?,?,?,?,?,?)",[Number(req.params.id),kind,description,quantity,unitPrice,+(quantity*unitPrice).toFixed(2),req.session.user.id]);res.json({ok:true});}catch{res.status(500).json({error:"No se pudo guardar el costo."});}});
  router.post("/admin/jobs/:id/time",async(req,res)=>{if(!v3Admin(req,res))return;const started=clean(req.body.started_at,30),ended=clean(req.body.ended_at,30);if(!started)return res.status(400).json({error:"Indicá el inicio del tiempo."});try{const minutes=ended?Math.max(0,Math.round((new Date(ended)-new Date(started))/60000)):0;await pool.query("INSERT INTO v3_job_time_entries(job_id,user_id,started_at,ended_at,minutes,description) VALUES(?,?,?,?,?,?)",[Number(req.params.id),req.session.user.id,started,ended||null,minutes,clean(req.body.description,255)||null]);res.json({ok:true});}catch{res.status(500).json({error:"No se pudo registrar el tiempo."});}});
  router.post("/admin/jobs/:id/notes",async(req,res)=>{if(!v3Admin(req,res))return;const note=clean(req.body.note,10000),visibility=clean(req.body.visibility,10)||"internal";if(!note||!["internal","client"].includes(visibility))return res.status(400).json({error:"Nota inválida."});try{await pool.query("INSERT INTO v3_job_notes(job_id,user_id,note,visibility) VALUES(?,?,?,?)",[Number(req.params.id),req.session.user.id,note,visibility]);await v3JobEvent(Number(req.params.id),req.session.user.id,"note_added",null,null,{visibility});res.status(201).json({ok:true});}catch{res.status(500).json({error:"No se pudo guardar la nota."});}});
  router.get("/client/jobs/:id",async(req,res)=>{const userId=v3RequireUser(req,res);if(!userId)return;try{const id=Number(req.params.id);const [[link]]=await pool.query("SELECT entity_id FROM v3_client_links WHERE user_id=? AND entity_type='job' AND entity_id=? LIMIT 1",[userId,id]);if(!link)return res.status(404).json({error:"Trabajo no encontrado."});const job=await v3JobDetail(id);if(!job)return res.status(404).json({error:"Trabajo no encontrado."});job.notes=(job.notes||[]).filter(n=>n.visibility==="client");delete job.internal_notes;delete job.execution_notes;delete job.events;res.json({ok:true,job});}catch{res.status(500).json({error:"No se pudo cargar el trabajo."});}});
  router.post("/admin/jobs/:id/sync-client",async(req,res)=>{if(!v3Admin(req,res))return;try{const [[job]]=await pool.query("SELECT id,client_id FROM jobs WHERE id=?",[Number(req.params.id)]);if(!job)return res.status(404).json({error:"Trabajo no encontrado."});if(job.client_id){const [[client]]=await pool.query("SELECT user_id FROM clients WHERE id=? LIMIT 1",[job.client_id]);if(client?.user_id){await v3Link(pool,client.user_id,"job",job.id);return res.json({ok:true,user_id:client.user_id});}}res.status(404).json({error:"El trabajo no tiene un cliente vinculado a una cuenta."});}catch{res.status(500).json({error:"No se pudo vincular el trabajo."});}});

  // =========================================================
  // V3 — BLOQUE G: FINANZAS
  // =========================================================
  async function v3FinanceEvent(type,id,event,actor,metadata={}) {
    await pool.query("INSERT INTO v3_finance_events(entity_type,entity_id,event_type,actor_user_id,metadata) VALUES(?,?,?,?,?)",[type,id,event,actor||null,JSON.stringify(metadata)]);
  }

  router.get("/admin/finance/summary",async(req,res)=>{
    if(!v3Admin(req,res))return;
    try{
      const [[income]]=await pool.query("SELECT COALESCE(SUM(total),0) total FROM v3_invoices WHERE status<>'anulada'");
      const [[collected]]=await pool.query("SELECT COALESCE(SUM(amount),0) total FROM v3_payments");
      const [[expenses]]=await pool.query("SELECT COALESCE(SUM(amount),0) total FROM v3_expenses WHERE status='registrado'");
      const pending=Math.max(0,Number(income.total)-Number(collected.total));
      res.json({ok:true,summary:{income:Number(income.total),collected:Number(collected.total),pending,expenses:Number(expenses.total),profit:Number(collected.total)-Number(expenses.total)}});
    }catch{res.status(500).json({error:"No se pudo cargar el resumen financiero."});}
  });

  router.get("/admin/finance/invoices",async(req,res)=>{
    if(!v3Admin(req,res))return;
    try{
      const [invoices]=await pool.query("SELECT i.*,qr.name AS client_name,q.quote_number FROM v3_invoices i LEFT JOIN clients c ON c.id=i.client_id LEFT JOIN quote_requests qr ON qr.client_id=c.id LEFT JOIN quotes q ON q.id=i.quote_id ORDER BY i.issue_date DESC,i.id DESC LIMIT 500");
      res.json({ok:true,invoices});
    }catch{res.status(500).json({error:"No se pudieron cargar las facturas."});}
  });

  router.post("/admin/finance/invoices",async(req,res)=>{
    if(!v3Admin(req,res))return;
    const quoteId=Number(req.body.quote_id||0)||null,jobId=Number(req.body.job_id||0)||null,clientId=Number(req.body.client_id||0)||null;
    const dueDate=clean(req.body.due_date,10)||null;
    try{
      let source=null;
      if(quoteId){const [[q]]=await pool.query("SELECT id,subtotal,tax_amount,total,quote_request_id FROM quotes WHERE id=?",[quoteId]);source=q;}
      if(!source&&jobId){const [[j]]=await pool.query("SELECT j.id,j.quote_id FROM jobs j WHERE j.id=?",[jobId]);if(j){const [[q]]=await pool.query("SELECT id,subtotal,tax_amount,total,quote_request_id FROM quotes WHERE id=?",[j.quote_id]);source=q;}}
      if(!source)return res.status(400).json({error:"Indicá un presupuesto o trabajo válido."});
      let cid=clientId;
      if(!cid&&source.quote_request_id){const [[qr]]=await pool.query("SELECT client_id FROM quote_requests WHERE id=?",[source.quote_request_id]);cid=qr?.client_id||null;}
      const [[settings]]=await pool.query("SELECT invoice_prefix,invoice_next_number FROM business_settings WHERE id=1 FOR UPDATE");
      const prefix=settings?.invoice_prefix||"FC-";const next=Number(settings?.invoice_next_number||1);const number=prefix+String(next).padStart(6,"0");
      await pool.query("UPDATE business_settings SET invoice_next_number=? WHERE id=1",[next+1]);
      const [result]=await pool.query("INSERT INTO v3_invoices(invoice_number,quote_id,job_id,client_id,issue_date,due_date,status,subtotal,tax_amount,total,created_by) VALUES(?,?,?,?,CURDATE(),?,'emitida',?,?,?,?)",[number,source.id,jobId,cid,dueDate,Number(source.subtotal||0),Number(source.tax_amount||0),Number(source.total||0),req.session.user.id]);
      await v3FinanceEvent("invoice",result.insertId,"created",req.session.user.id,{quote_id:quoteId,job_id:jobId});
      res.status(201).json({ok:true,id:result.insertId,invoice_number:number});
    }catch(error){console.error("V3 invoice:",error);res.status(500).json({error:"No se pudo crear la factura."});}
  });

  router.get("/admin/finance/payments",async(req,res)=>{
    if(!v3Admin(req,res))return;
    try{const [payments]=await pool.query("SELECT p.*,i.invoice_number,COALESCE(c.name,qr.name) AS client_name FROM v3_payments p LEFT JOIN v3_invoices i ON i.id=p.invoice_id LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN quote_requests qr ON qr.client_id=c.id ORDER BY p.payment_date DESC,p.id DESC LIMIT 500");res.json({ok:true,payments});}
    catch{res.status(500).json({error:"No se pudieron cargar los cobros."});}
  });

  router.post("/admin/finance/payments",async(req,res)=>{
    if(!v3Admin(req,res))return;
    const amount=Number(req.body.amount),invoiceId=Number(req.body.invoice_id||0)||null;
    const method=clean(req.body.method,30)||"transferencia",paymentDate=clean(req.body.payment_date,10);
    if(!Number.isFinite(amount)||amount<=0||!dateOnly(paymentDate))return res.status(400).json({error:"Cobro inválido."});
    if(!["efectivo","transferencia","tarjeta","mercadopago","otro"].includes(method))return res.status(400).json({error:"Medio de pago inválido."});
    try{
      let meta={};if(invoiceId){const [[i]]=await pool.query("SELECT id,quote_id,job_id,client_id,total FROM v3_invoices WHERE id=?",[invoiceId]);if(!i)return res.status(404).json({error:"Factura no encontrada."});meta=i;}
      const [r]=await pool.query("INSERT INTO v3_payments(invoice_id,quote_id,job_id,client_id,amount,payment_date,method,reference,notes,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)",[invoiceId,meta.quote_id||null,meta.job_id||null,meta.client_id||null,amount,paymentDate,method,clean(req.body.reference,120)||null,clean(req.body.notes,2000)||null,req.session.user.id]);
      if(invoiceId){const [[p]]=await pool.query("SELECT COALESCE(SUM(amount),0) total FROM v3_payments WHERE invoice_id=?",[invoiceId]);if(Number(p.total)>=Number(meta.total))await pool.query("UPDATE v3_invoices SET status='pagada' WHERE id=?",[invoiceId]);}
      await v3FinanceEvent("payment",r.insertId,"created",req.session.user.id,{invoice_id:invoiceId,amount});
      res.status(201).json({ok:true,id:r.insertId});
    }catch{res.status(500).json({error:"No se pudo registrar el cobro."});}
  });

  router.get("/admin/finance/expenses",async(req,res)=>{
    if(!v3Admin(req,res))return;
    try{const [expenses]=await pool.query("SELECT e.*,j.job_number FROM v3_expenses e LEFT JOIN jobs j ON j.id=e.job_id ORDER BY e.expense_date DESC,e.id DESC LIMIT 500");res.json({ok:true,expenses});}
    catch{res.status(500).json({error:"No se pudieron cargar los gastos."});}
  });

  router.post("/admin/finance/expenses",async(req,res)=>{
    if(!v3Admin(req,res))return;
    const amount=Number(req.body.amount),expenseDate=clean(req.body.expense_date,10),category=clean(req.body.category,80),description=clean(req.body.description,255);
    if(!Number.isFinite(amount)||amount<=0||!dateOnly(expenseDate)||!category||!description)return res.status(400).json({error:"Gasto inválido."});
    try{const [r]=await pool.query("INSERT INTO v3_expenses(expense_date,category,description,amount,supplier,job_id,created_by) VALUES(?,?,?,?,?,?,?)",[expenseDate,category,description,amount,clean(req.body.supplier,190)||null,Number(req.body.job_id||0)||null,req.session.user.id]);await v3FinanceEvent("expense",r.insertId,"created",req.session.user.id,{amount,category});res.status(201).json({ok:true,id:r.insertId});}
    catch{res.status(500).json({error:"No se pudo registrar el gasto."});}
  });

  router.get("/admin/finance/client/:id",async(req,res)=>{
    if(!v3Admin(req,res))return;
    const id=Number(req.params.id);
    try{const [[inv]]=await pool.query("SELECT COALESCE(SUM(total),0) total FROM v3_invoices WHERE client_id=? AND status<>'anulada'",[id]);const [[pay]]=await pool.query("SELECT COALESCE(SUM(amount),0) total FROM v3_payments WHERE client_id=?",[id]);res.json({ok:true,client_id:id,balance:Math.max(0,Number(inv.total)-Number(pay.total)),invoiced:Number(inv.total),collected:Number(pay.total)});}
    catch{res.status(500).json({error:"No se pudo consultar el saldo del cliente."});}
  });

  router.get("/admin/finance/report",async(req,res)=>{
    if(!v3Admin(req,res))return;
    try{
      const [[inc]]=await pool.query("SELECT COALESCE(SUM(total),0) total FROM v3_invoices WHERE status<>'anulada'");
      const [[exp]]=await pool.query("SELECT COALESCE(SUM(amount),0) total FROM v3_expenses WHERE status='registrado'");
      const [[col]]=await pool.query("SELECT COALESCE(SUM(amount),0) total FROM v3_payments");
      const [byMethod]=await pool.query("SELECT method,SUM(amount) total FROM v3_payments GROUP BY method ORDER BY total DESC");
      const [byMonth]=await pool.query("SELECT DATE_FORMAT(payment_date,'%Y-%m') month,SUM(amount) total FROM v3_payments GROUP BY month ORDER BY month DESC LIMIT 12");
      res.json({ok:true,report:{income:Number(inc.total),expenses:Number(exp.total),collected:Number(col.total),profit:Number(col.total)-Number(exp.total),pending:Math.max(0,Number(inc.total)-Number(col.total)),byMethod,byMonth}});
    }catch{res.status(500).json({error:"No se pudo generar el reporte financiero."});}
  });


  return router;
}

module.exports = { V3_VERSION, V3_API_PREFIX, v3Metadata, v3SecurityHeaders, createV3Router };