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

  return router;
}

module.exports = { V3_VERSION, V3_API_PREFIX, v3Metadata, v3SecurityHeaders, createV3Router };