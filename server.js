require("dotenv").config();

const express = require("express");
const PDFDocument = require("pdfkit");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const mysql = require("mysql2/promise");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const nodemailer = require("nodemailer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const fs = require("fs");
const { createRequestId, info: logInfo, error: logError } = require("./lib/logger");
const { runMigrations } = require("./lib/migrations");
const {
  PASSWORD_MIN,
  PASSWORD_MAX,
  validatePassword,
  generateTotpSecret,
  verifyTotp,
  encryptSecret,
  decryptSecret,
  hashBackupCode,
  generateBackupCodes
} = require("./lib/security");

const app = express();
app.disable("x-powered-by");

app.use((req, res, next) => {
  req.requestId = req.get("X-Request-ID") || createRequestId();
  res.setHeader("X-Request-ID", req.requestId);
  const startedAt = Date.now();
  res.on("finish", () => {
    logInfo("HTTP", {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });
  next();
});
const PORT = process.env.PORT || 3000;


// =========================================================
// CONFIGURACIÓN DE UPLOADS - GALERÍA
// =========================================================

const uploadsDir = path.join(__dirname, "public", "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({

  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },

  filename: (req, file, cb) => {

    const ext = path.extname(file.originalname).toLowerCase();

    const safeName =
      Date.now() +
      "-" +
      crypto.randomBytes(8).toString("hex") +
      ext;

    cb(null, safeName);
  }

});


const upload = multer({

  storage,

  limits: {
    fileSize: 5 * 1024 * 1024
  },

  fileFilter: (req, file, cb) => {

    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif"
    ];

    if (!allowed.includes(file.mimetype)) {

      return cb(
        new Error(
          "Solo se permiten imágenes JPG, PNG, WEBP o GIF."
        )
      );

    }

    cb(null, true);
  }

});


// =========================================================
async function validateUploadedImage(req, res, next) {
  if (!req.file) return next();

  try {
    const header = Buffer.alloc(12);
    const handle = await fs.promises.open(req.file.path, "r");
    try {
      await handle.read(header, 0, 12, 0);
    } finally {
      await handle.close();
    }

    const mime = req.file.mimetype;
    let valid = false;

    if (mime === "image/jpeg") {
      valid = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    } else if (mime === "image/png") {
      valid = header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    } else if (mime === "image/gif") {
      const signature = header.subarray(0, 6).toString("ascii");
      valid = signature === "GIF87a" || signature === "GIF89a";
    } else if (mime === "image/webp") {
      valid = header.subarray(0, 4).toString("ascii") === "RIFF" &&
              header.subarray(8, 12).toString("ascii") === "WEBP";
    }

    if (!valid) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({
        error: "El archivo no es una imagen válida del tipo indicado."
      });
    }

    next();
  } catch (error) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    console.error("Error validando imagen:", error.message);
    return res.status(400).json({
      error: "No se pudo validar la imagen."
    });
  }
}


// MYSQL
// =========================================================

const pool = mysql.createPool({

  host: process.env.DB_HOST,

  port: Number(
    process.env.DB_PORT || 3306
  ),

  user: process.env.DB_USER,

  password: process.env.DB_PASSWORD,

  database: process.env.DB_NAME,

  waitForConnections: true,

  connectionLimit: 10,

  charset: "utf8mb4"

});


// =========================================================
// MIDDLEWARE
// =========================================================

app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(
  express.urlencoded({
    extended: false
  })
);

app.use(express.json({ limit: "100kb" }));

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


// =========================================================
// SESIONES
// =========================================================

app.use(
  session({

    secret: process.env.SESSION_SECRET,

    resave: false,

    saveUninitialized: false,

    store: new MySQLStore({}, pool),

    cookie: {

      httpOnly: true,

      sameSite: "lax",

      secure:
        process.env.NODE_ENV === "production",

      maxAge:
        1000 * 60 * 60 * 8,
      name:
        process.env.NODE_ENV === "production"
          ? "__Host-jr_session"
          : "jr_session"

    }

  })
);


// =========================================================
 // V2 — CSRF / ORIGIN
app.use(requireCsrfOrigin);

// =========================================================
// V2 — AUDITORÍA DE MUTACIONES ADMIN
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/admin/") || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  res.on("finish", () => {
    if (res.statusCode < 500 && req.session?.user?.id) {
      writeAudit(req, "admin_mutation", req.path.split("/")[3] || "admin", req.params?.id || null, {
        method: req.method,
        status: res.statusCode
      });
    }
  });
  next();
});

// RATE LIMIT
// =========================================================

const authLimiter = rateLimit({

  windowMs:
    15 * 60 * 1000,

  limit: 20,

  standardHeaders: true,

  legacyHeaders: false

});

const adminMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
});

app.use((req, res, next) => {
  if (
    req.path.startsWith("/api/admin/") &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
  ) {
    return adminMutationLimiter(req, res, next);
  }
  next();
});


// =========================================================
// AUTENTICACIÓN
// =========================================================

async function invalidateUserSessions(userId, keepSessionId = null) {
  const pattern = '%"user":{"id":' + Number(userId) + ',%';
  if (keepSessionId) {
    await pool.query(`DELETE FROM sessions WHERE session_id <> ? AND data LIKE ?`, [keepSessionId, pattern]);
    return;
  }
  await pool.query(`DELETE FROM sessions WHERE data LIKE ?`, [pattern]);
}

async function isLoginLocked(email, ip) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS failures
     FROM login_attempts
     WHERE email=? AND ip_address=? AND success=0
       AND created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)`,
    [email, ip || ""]
  );
  return Number(rows[0]?.failures || 0) >= 5;
}

async function validateLoginLock(email, ip) {
  return isLoginLocked(email, ip);
}

function requireAuth(req, res, next) {

  if (!req.session.user) {

    return res.status(401).json({
      error: "Debes iniciar sesión."
    });

  }

  next();
}


async function requireAdmin(req, res, next) {

  if (!req.session.user) {
    return res.status(403).json({
      error: "Acceso exclusivo para administradores."
    });
  }

  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, role FROM users WHERE id=? LIMIT 1",
      [req.session.user.id]
    );

    if (!rows.length || rows[0].role !== "admin") {
      await new Promise(resolve => req.session.destroy(() => resolve()));
      return res.status(403).json({
        error: "Acceso exclusivo para administradores."
      });
    }

    req.session.user = cleanUser(rows[0]);
    next();
  } catch (error) {
    console.error("Error verificando permisos de administrador:", error);
    return res.status(500).json({
      error: "No se pudieron verificar los permisos."
    });
  }
}


async function registerActiveSession(req, userId) {
  if (!req.sessionID || !userId) return;
  await pool.query(
    `INSERT INTO active_sessions
      (session_id, user_id, ip_address, user_agent)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       ip_address=VALUES(ip_address),
       user_agent=VALUES(user_agent),
       last_seen_at=CURRENT_TIMESTAMP`,
    [
      req.sessionID,
      Number(userId),
      req.ip || null,
      String(req.get("user-agent") || "").slice(0, 512) || null
    ]
  );
}

async function removeActiveSession(sessionId) {
  if (!sessionId) return;
  await pool.query("DELETE FROM active_sessions WHERE session_id=?", [sessionId]).catch(() => {});
}

async function removeAllActiveSessions(userId, keepSessionId = null) {
  if (keepSessionId) {
    await pool.query("DELETE FROM active_sessions WHERE user_id=? AND session_id<>?", [userId, keepSessionId]);
  } else {
    await pool.query("DELETE FROM active_sessions WHERE user_id=?", [userId]);
  }
}

function requireCsrfOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  const site = req.get("Sec-Fetch-Site");
  if (site === "cross-site") {
    return res.status(403).json({ success: false, error: "Solicitud cross-site bloqueada." });
  }

  const origin = req.get("Origin");
  const forwardedHost = req.get("X-Forwarded-Host");
  const host = forwardedHost || req.get("Host");
  const targetOrigin = `${req.protocol}://${host}`;

  if (origin) {
    if (origin !== targetOrigin) {
      return res.status(403).json({ success: false, error: "Origen no autorizado." });
    }
    return next();
  }

  const referer = req.get("Referer");
  if (referer) {
    try {
      if (new URL(referer).origin === targetOrigin) return next();
    } catch {}
  }

  if (process.env.NODE_ENV !== "production") return next();

  return res.status(403).json({ success: false, error: "No se pudo verificar el origen de la solicitud." });
}

async function writeAudit(req, action, entityType = null, entityId = null, metadata = null) {
  try {
    await pool.query(
      `INSERT INTO audit_log
        (actor_user_id, action, entity_type, entity_id, ip_address, user_agent, request_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.session?.user?.id || null,
        action,
        entityType,
        entityId == null ? null : String(entityId),
        req.ip || null,
        String(req.get("user-agent") || "").slice(0, 512) || null,
        req.requestId || null,
        metadata ? JSON.stringify(metadata) : null
      ]
    );
  } catch (error) {
    logError("No se pudo registrar auditoría", { requestId: req.requestId, action, error: error.message });
  }
}

async function recordLoginAttempt(req, email, success, userId = null) {
  try {
    await pool.query(
      `INSERT INTO login_attempts
        (user_id, email, success, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [
        userId,
        String(email || "").slice(0, 190),
        success ? 1 : 0,
        req.ip || null,
        String(req.get("user-agent") || "").slice(0, 512) || null
      ]
    );
  } catch (error) {
    logError("No se pudo registrar intento de login", { requestId: req.requestId, error: error.message });
  }
}

function cleanUser(user) {

  return {

    id: user.id,

    name: user.name,

    email: user.email,

    role: user.role

  };

}


// =========================================================
// EMAIL DE RECUPERACIÓN
// =========================================================

async function sendResetEmail(
  email,
  token
) {

  const transporter =
    nodemailer.createTransport({

      host: process.env.SMTP_HOST,

      port: Number(
        process.env.SMTP_PORT || 465
      ),

      secure:
        String(
          process.env.SMTP_SECURE
        ).toLowerCase() === "true",

      auth: {

        user:
          process.env.SMTP_USER,

        pass:
          process.env.SMTP_PASSWORD

      }

    });


  const link =
    `${process.env.APP_URL}/reset-password.html?token=${encodeURIComponent(token)}`;


  await transporter.sendMail({

    from:
      process.env.MAIL_FROM,

    to:
      email,

    subject:
      "Recuperación de contraseña - JR Electricidad",

    html: `

      <div style="font-family:Arial,sans-serif;line-height:1.6">

        <h2>
          JR Electricidad ⚡
        </h2>

        <p>
          Recibimos una solicitud para cambiar tu contraseña.
        </p>

        <p>
          <a href="${link}">
            Restablecer contraseña
          </a>
        </p>

        <p>
          Este enlace vence en 30 minutos.
        </p>

        <p>
          Si no solicitaste este cambio,
          puedes ignorar este correo.
        </p>

      </div>

    `

  });

}


// =========================================================
// CUENTA DEL USUARIO - CONTRASEÑA
// =========================================================

app.put(
  "/api/account/password",
  requireAuth,
  authLimiter,
  async (req, res) => {

    try {

      const currentPassword =
        String(
          req.body.currentPassword || ""
        );

      const newPassword =
        String(
          req.body.newPassword || ""
        );


      if (
        !currentPassword ||
        !newPassword
      ) {

        return res.status(400).json({
          error:
            "Completa todos los campos."
        });

      }


      if (newPassword.length < 8 || newPassword.length > 200) {

        return res.status(400).json({
          error:
            "La nueva contraseña debe tener entre 8 y 200 caracteres."
        });

      }


      if (
        currentPassword ===
        newPassword
      ) {

        return res.status(400).json({
          error:
            "La nueva contraseña debe ser diferente a la actual."
        });

      }


      const [rows] =
        await pool.query(
          `
          SELECT
            id,
            password_hash
          FROM users
          WHERE id=?
          LIMIT 1
          `,
          [
            req.session.user.id
          ]
        );


      if (!rows.length) {

        return res.status(404).json({
          error:
            "Usuario no encontrado."
        });

      }


      const validPassword =
        await bcrypt.compare(
          currentPassword,
          rows[0].password_hash
        );


      if (!validPassword) {

        return res.status(401).json({
          error:
            "La contraseña actual es incorrecta."
        });

      }


      const hash =
        await bcrypt.hash(
          newPassword,
          12
        );


      await pool.query(
        `
        UPDATE users
        SET password_hash=?
        WHERE id=?
        `,
        [          hash,
          req.session.user.id
        ]
      );


      const user =
        {
          ...req.session.user
        };


      await new Promise(
        (resolve, reject) => {

          req.session.regenerate(
            (err) => {

              if (err) {
                return reject(err);
              }

              resolve();

            }
          );

        }
      );


      req.session.user = user;


      await new Promise(
        (resolve, reject) => {

          req.session.save(
            (err) => {

              if (err) {
                return reject(err);
              }

              resolve();

            }
          );

        }
      );


      await invalidateUserSessions(req.session.user.id, req.sessionID);


      res.json({

        ok: true,

        message:
          "Contraseña actualizada. Las demás sesiones fueron cerradas."

      });


    } catch (e) {

      console.error(e);

      res.status(500).json({

        error:
          "No se pudo cambiar la contraseña."

      });

    }

  }
);


// =========================================================
// CUENTA DEL USUARIO - EMAIL
// =========================================================

app.put(
  "/api/account/email",
  requireAuth,
  authLimiter,
  async (req, res) => {

    try {

      const newEmail =
        String(
          req.body.newEmail || ""
        )
        .trim()
        .toLowerCase();


      const currentPassword =
        String(
          req.body.currentPassword || ""
        );


      if (
        !newEmail ||
        !currentPassword
      ) {

        return res.status(400).json({
          error:
            "Completa todos los campos."
        });

      }


      const emailRegex =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


      if (!emailRegex.test(newEmail)) {

        return res.status(400).json({
          error:
            "Ingresá un correo electrónico válido."
        });

      }


      if (
        newEmail ===
        req.session.user.email
      ) {

        return res.status(400).json({
          error:
            "El nuevo correo es igual al actual."
        });

      }


      const [existing] =
        await pool.query(
          `
          SELECT id
          FROM users
          WHERE email=?
          AND id<>?
          LIMIT 1
          `,
          [
            newEmail,
            req.session.user.id
          ]
        );


      if (existing.length) {

        return res.status(409).json({
          error:
            "Ese correo ya está registrado."
        });

      }


      const [rows] =
        await pool.query(
          `
          SELECT
            id,
            password_hash
          FROM users
          WHERE id=?
          LIMIT 1
          `,
          [
            req.session.user.id
          ]
        );


      if (!rows.length) {

        return res.status(404).json({
          error:
            "Usuario no encontrado."
        });

      }


      const validPassword =
        await bcrypt.compare(
          currentPassword,
          rows[0].password_hash
        );


      if (!validPassword) {

        return res.status(401).json({
          error:
            "La contraseña actual es incorrecta."
        });

      }


      await pool.query(
        `
        UPDATE users
        SET email=?
        WHERE id=?
        `,
        [
          newEmail,
          req.session.user.id
        ]
      );


      req.session.user.email =
        newEmail;


      res.json({

        ok: true,

        message:
          "Correo electrónico actualizado correctamente.",

        user:
          cleanUser(
            req.session.user
          )

      });


    } catch (e) {

      console.error(e);

      res.status(500).json({

        error:
          "No se pudo cambiar el correo electrónico."

      });

    }

  }
);


// =========================================================
// CONFIGURACIÓN DEL NEGOCIO
// =========================================================

async function ensureNotificationSchema() {
  await pool.query("ALTER TABLE admin_notifications MODIFY quote_id INT NULL").catch(error => {
    if (!/Duplicate|already exists/i.test(error.message)) throw error;
  });

  await pool.query(
    "ALTER TABLE admin_notifications MODIFY type ENUM('quote_accepted','quote_rejected','quote_request_created','quote_request_status','job_started','job_closed') NOT NULL"
  );

  await pool.query(
    "ALTER TABLE admin_notifications ADD INDEX idx_notifications_read_created (is_read, created_at)"
  ).catch(error => {
    if (!/Duplicate key name|already exists/i.test(error.message)) throw error;
  });
}

async function ensureServiceColumns() {
  await pool.query("ALTER TABLE services ADD COLUMN category VARCHAR(100) NOT NULL DEFAULT '' AFTER description").catch(error => {
    if (!/Duplicate column name/i.test(error.message)) throw error;
  });
  await pool.query("ALTER TABLE services ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER active").catch(error => {
    if (!/Duplicate column name/i.test(error.message)) throw error;
  });
  await pool.query("UPDATE services SET sort_order=id WHERE sort_order=0");
}

async function ensureBusinessSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS business_settings (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      business_name VARCHAR(150) NOT NULL DEFAULT 'JR Electricidad',
      legal_name VARCHAR(180) DEFAULT '',
      phone VARCHAR(50) DEFAULT '',
      whatsapp VARCHAR(50) DEFAULT '',
      email VARCHAR(190) DEFAULT '',
      address VARCHAR(255) DEFAULT '',
      city VARCHAR(120) DEFAULT '',
      hours VARCHAR(255) DEFAULT '',
      logo_url VARCHAR(500) DEFAULT '',
      pdf_footer VARCHAR(500) DEFAULT '',
      pdf_notes TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    INSERT INTO business_settings
      (id, business_name, phone, whatsapp, email, pdf_footer)
    VALUES
      (1, 'JR Electricidad', '3385684660', '3385684660',
       'jorge9609@hotmail.com',
       'JR Electricidad · Electricista Matriculado Cat. 3')
    ON DUPLICATE KEY UPDATE id = id
  `);
}

app.get(
  "/api/admin/settings",
  requireAdmin,
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT * FROM business_settings WHERE id=1 LIMIT 1"
      );

      res.json({
        success: true,
        settings: rows[0] || null
      });
    } catch (error) {
      console.error("Error obteniendo configuración:", error);
      res.status(500).json({
        error: "No se pudo obtener la configuración."
      });
    }
  }
);

app.put(
  "/api/admin/settings",
  requireAdmin,
  async (req, res) => {
    try {
      const fields = {
        business_name: String(req.body.business_name || "").trim(),
        legal_name: String(req.body.legal_name || "").trim(),
        phone: String(req.body.phone || "").trim(),
        whatsapp: String(req.body.whatsapp || "").trim(),
        email: String(req.body.email || "").trim().toLowerCase(),
        address: String(req.body.address || "").trim(),
        city: String(req.body.city || "").trim(),
        hours: String(req.body.hours || "").trim(),
        logo_url: String(req.body.logo_url || "").trim(),
        pdf_footer: String(req.body.pdf_footer || "").trim(),
        pdf_notes: String(req.body.pdf_notes || "").trim()
      };

      if (!fields.business_name) {
        return res.status(400).json({
          error: "El nombre comercial es obligatorio."
        });
      }

      if (fields.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(fields.email)) {
          return res.status(400).json({
            error: "Ingresá un email válido."
          });
        }
      }

      const limits = {
        business_name: 150,
        legal_name: 180,
        phone: 50,
        whatsapp: 50,
        email: 190,
        address: 255,
        city: 120,
        hours: 255,
        logo_url: 500,
        pdf_footer: 500,
        pdf_notes: 5000
      };

      for (const [key, max] of Object.entries(limits)) {
        if (fields[key].length > max) {
          return res.status(400).json({
            error: `El campo ${key} supera el máximo permitido.`
          });
        }
      }

      await pool.query(
        `
        UPDATE business_settings
        SET business_name=?, legal_name=?, phone=?, whatsapp=?,
            email=?, address=?, city=?, hours=?, logo_url=?,
            pdf_footer=?, pdf_notes=?
        WHERE id=1
        `,
        [
          fields.business_name,
          fields.legal_name,
          fields.phone,
          fields.whatsapp,
          fields.email,
          fields.address,
          fields.city,
          fields.hours,
          fields.logo_url,
          fields.pdf_footer,
          fields.pdf_notes
        ]
      );

      res.json({
        success: true,
        message: "Configuración guardada correctamente."
      });
    } catch (error) {
      console.error("Error guardando configuración:", error);
      res.status(500).json({
        error: "No se pudo guardar la configuración."
      });
    }
  }
);


app.get(
  "/api/settings",
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT business_name, phone, whatsapp, email, address, city, hours, logo_url
         FROM business_settings
         WHERE id=1
         LIMIT 1`
      );

      res.json({
        success: true,
        settings: rows[0] || null
      });
    } catch (error) {
      console.error("Error obteniendo datos públicos:", error);
      res.status(500).json({
        error: "No se pudieron obtener los datos del negocio."
      });
    }
  }
);


// =========================================================
// CUENTA DEL USUARIO - PERFIL
// =========================================================

app.put(
  "/api/account/profile",
  requireAuth,
  authLimiter,
  async (req, res) => {
    try {
      const userId = Number(req.session.user.id);
      const name = String(req.body.name || "").trim();
      const email = String(req.body.email || "").trim().toLowerCase();

      if (!name || name.length > 100) {
        return res.status(400).json({ error: "El nombre es obligatorio y no puede superar 100 caracteres." });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email) || email.length > 190) {
        return res.status(400).json({ error: "Ingresá un email válido." });
      }

      const [existing] = await pool.query(
        "SELECT id FROM users WHERE email=? AND id<>? LIMIT 1",
        [email, userId]
      );

      if (existing.length) {
        return res.status(409).json({ error: "Ese email ya está registrado." });
      }

      await pool.query(
        "UPDATE users SET name=?, email=? WHERE id=?",
        [name, email, userId]
      );

      req.session.user.name = name;
      req.session.user.email = email;

      res.json({
        success: true,
        message: "Datos personales actualizados correctamente.",
        user: cleanUser(req.session.user)
      });
    } catch (error) {
      console.error("Error actualizando perfil:", error);
      res.status(500).json({ error: "No se pudieron actualizar los datos personales." });
    }
  }
);


// =========================================================
// USUARIO ACTUAL
// =========================================================

app.get(
  "/api/me",
  (req, res) => {

    res.json({

      user:
        req.session.user
          ? cleanUser(
              req.session.user
            )
          : null

    });

  }
);


// =========================================================
// REGISTRO
// =========================================================

app.post(
  "/api/register",
  authLimiter,
  async (req, res) => {

    try {

      const {
        name,
        email,
        password
      } = req.body;


      if (
        !name ||
        !email ||
        !password
      ) {

        return res.status(400).json({
          error:
            "Completa todos los campos."
        });

      }


      if (name.trim().length > 100 || email.trim().length > 190) {
        return res.status(400).json({
          error: "El nombre o correo supera el máximo permitido."
        });
      }

      if (password.length < 8 || password.length > 200) {

        return res.status(400).json({
          error:
            "La contraseña debe tener al menos 8 caracteres."
        });

      }


      const normalized =
        email
          .trim()
          .toLowerCase();


      const [exists] =
        await pool.query(
          `
          SELECT id
          FROM users
          WHERE email=?
          `,
          [
            normalized
          ]
        );


      if (exists.length) {

        return res.status(409).json({
          error:
            "Ese correo ya está registrado."
        });

      }


      const hash =
        await bcrypt.hash(
          password,
          12
        );


      const [result] =
        await pool.query(
          `
          INSERT INTO users
          (name,email,password_hash)
          VALUES (?,?,?)
          `,
          [
            name.trim(),
            normalized,
            hash
          ]
        );


      const registeredUser = { id: result.insertId, name: name.trim(), email: normalized, role: "user" };
      await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
      req.session.user = registeredUser;
      await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
      await writeAudit(req, "register", "user", result.insertId);

      res.json({

        ok: true,

        user:
          cleanUser(
            req.session.user
          )

      });


    } catch (e) {

      console.error(e);

      res.status(500).json({

        error:
          "No se pudo crear la cuenta."

      });

    }

  }
);


// =========================================================
// LOGIN
// =========================================================

app.post(
  "/api/login",
  authLimiter,
  async (req, res) => {

    try {

      const email =
        (
          req.body.email || ""
        )
        .trim()
        .toLowerCase();


      const password =
        req.body.password || "";

      if (email.length > 190 || password.length > 200) {
        return res.status(400).json({
          error: "Credenciales inválidas."
        });
      }


      const [rows] =
        await pool.query(
          `
          SELECT
            id,
            name,
            email,
            password_hash,
            role,
            created_at
          FROM users
          WHERE email=?
          LIMIT 1
          `,
          [
            email
          ]
        );


      const passwordValid = rows.length
        ? await bcrypt.compare(password, rows[0].password_hash)
        : false;

      await recordLoginAttempt(req, email, passwordValid, rows[0]?.id || null);

      if (!rows.length || !passwordValid) {

        return res.status(401).json({
          error:
            "Correo o contraseña incorrectos."
        });

      }


      const loggedUser = cleanUser(rows[0]);
      await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
      req.session.user = loggedUser;
      await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
      if (loggedUser.role === "admin") {
        const [securityRows] = await pool.query(
          "SELECT totp_enabled FROM users WHERE id=? LIMIT 1",
          [loggedUser.id]
        );
        if (securityRows[0]?.totp_enabled) {
          req.session.pending2fa = {
            userId: loggedUser.id,
            createdAt: Date.now()
          };
          await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
          await writeAudit(req, "login_password_verified_2fa_pending", "user", loggedUser.id);
          return res.json({
            ok: true,
            requires2fa: true,
            message: "Ingresá el código de autenticación de dos factores."
          });
        }
      }

      await registerActiveSession(req, loggedUser.id);
      await writeAudit(req, "login", "user", loggedUser.id);

      res.json({

        ok: true,

        user:
          req.session.user

      });


    } catch (e) {

      console.error(e);

      res.status(500).json({

        error:
          "No se pudo iniciar sesión."
      });

    }

  }
);


// =========================================================
// LOGOUT
// =========================================================

app.post(
  "/api/logout",
  (req, res) => {

    req.session.destroy(
      () => {

        res.json({
          ok: true
        });

      }
    );

  }
);


// =========================================================
// RECUPERAR CONTRASEÑA
// =========================================================

app.post(
  "/api/forgot-password",
  authLimiter,
  async (req, res) => {

    try {

      const email =
        (
          req.body.email || ""
        )
        .trim()
        .toLowerCase();


      const [rows] =
        await pool.query(
          `
          SELECT
            id,
            email
          FROM users
          WHERE email=?
          `,
          [
            email
          ]
        );


      if (rows.length) {

        const token =
          crypto.randomBytes(32)
            .toString("hex");


        const tokenHash =
          crypto.createHash(
            "sha256"
          )
          .update(token)
          .digest("hex");


        await pool.query(
          `
          INSERT INTO password_resets
          (
            user_id,
            token_hash,
            expires_at
          )
          VALUES
          (
            ?,
            ?,
            DATE_ADD(
              NOW(),
              INTERVAL 30 MINUTE
            )
          )
          `,
          [
            rows[0].id,
            tokenHash
          ]
        );


        try {

          await sendResetEmail(
            rows[0].email,
            token
          );

        } catch (mailError) {

          console.error(
            "SMTP:",
            mailError.message
          );

        }

      }


      res.json({

        ok: true,

        message:
          "Si el correo está registrado, recibirás instrucciones para recuperar tu contraseña."

      });


    } catch (e) {

      console.error(e);

      res.status(500).json({

        error:
          "No se pudo procesar la solicitud."

      });

    }

  }
);


// =========================================================
// RESTABLECER CONTRASEÑA
// =========================================================

app.post(
  "/api/reset-password",
  authLimiter,
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const {
        token,
        password
      } = req.body;

      if (
        !token ||
        typeof token !== "string" ||
        !password ||
        typeof password !== "string" ||
        password.length < 8 ||
        password.length > 200
      ) {
        return res.status(400).json({
          error: "Token o contraseña inválidos."
        });
      }

      const tokenHash =
        crypto
          .createHash("sha256")
          .update(token)
          .digest("hex");

      await connection.beginTransaction();

      const [rows] = await connection.query(
        `
        SELECT
          id,
          user_id
        FROM password_resets
        WHERE token_hash=?
          AND used=0
          AND expires_at > NOW()
        LIMIT 1
        FOR UPDATE
        `,
        [tokenHash]
      );

      if (!rows.length) {
        await connection.rollback();

        return res.status(400).json({
          error: "El enlace no es válido o ya venció."
        });
      }

      const hash =
        await bcrypt.hash(password, 12);

      await connection.query(
        `
        UPDATE users
        SET password_hash=?
        WHERE id=?
        `,
        [hash, rows[0].user_id]
      );

      await connection.query(
        `
        UPDATE password_resets
        SET used=1
        WHERE id=?
        `,
        [rows[0].id]
      );

      await connection.commit();

      await invalidateUserSessions(
        rows[0].user_id
      );

      return res.json({
        ok: true,
        message:
          "Contraseña actualizada correctamente."
      });

    } catch (e) {
      await connection.rollback().catch(() => {});

      console.error(
        "Error restableciendo contraseña:",
        e
      );

      return res.status(500).json({
        error:
          "No se pudo cambiar la contraseña."
      });

    } finally {
      connection.release();
    }
  }
)

// ========================================
// SOLICITUDES DE PRESUPUESTO - PÚBLICA
// ========================================

app.post(
  "/api/quote-requests",
  authLimiter,
  upload.single("image"),
  validateUploadedImage,
  async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      service,
      description,
      preferred_date
    } = req.body;

    // Validaciones básicas
    if (!name || !phone || !description) {
      return res.status(400).json({
        error: "Completá nombre, teléfono y descripción."
      });
    }

    const cleanName = String(name).trim();
    const cleanPhone = String(phone).trim();
    const cleanEmail = email ? String(email).trim().toLowerCase() : null;
    const cleanService = service ? String(service).trim() : null;
    const cleanDescription = String(description).trim();

    let imageUrl = null;

    if (req.file) {
      imageUrl = "/uploads/" + req.file.filename;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (cleanEmail && !emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        error: "El email no es válido."
      });
    }

    if (preferred_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(preferred_date))) {
      return res.status(400).json({
        error: "La fecha preferida no es válida."
      });
    }

    // Limitar tamaño de los datos
    if (
      cleanName.length > 150 ||
      cleanPhone.length > 50 ||
      (cleanEmail && cleanEmail.length > 150) ||
      (cleanService && cleanService.length > 150) ||
      cleanDescription.length > 2000
    ) {
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {}
      }
      return res.status(400).json({
        error: "Uno de los campos supera el límite permitido."
      });
    }

    const [result] = await pool.query(
      `
      INSERT INTO quote_requests
      (
        name,
        phone,
        email,
        service,
        description,
        preferred_date,
        image_url
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        cleanName,
        cleanPhone,
        cleanEmail,
        cleanService,
        cleanDescription,
        preferred_date || null,
        imageUrl
      ]
    );

    // La solicitud ya fue guardada correctamente. La notificación
    // administrativa no debe hacer fallar el envío al cliente si su
    // tabla/estructura presenta un problema puntual.
    try {
      await pool.query(
        `
        INSERT INTO admin_notifications (type, quote_id, message)
        VALUES ('quote_request_created', NULL, ?)
        `,
        [`Nueva solicitud de presupuesto de ${cleanName}.`]
      );
    } catch (notificationError) {
      console.error(
        "Solicitud guardada, pero no se pudo crear la notificación:",
        notificationError
      );
    }

    res.status(201).json({
      success: true,
      message: "Solicitud enviada correctamente.",
      id: result.insertId
    });

  } catch (error) {

    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {}
    }

    console.error(
      "Error guardando solicitud de presupuesto:",
      error
    );

    res.status(500).json({
      error: "No se pudo enviar la solicitud."
    });
  }
});
// =========================================================
// GALERÍA PÚBLICA
// =========================================================

app.get(
  "/api/gallery",
  async (req, res) => {

    try {

      const [rows] =
        await pool.query(`
          SELECT
  id,
  title,
  description,
  image_url,
  featured,
  sort_order
FROM gallery
WHERE active = 1
ORDER BY
  featured DESC,
  sort_order ASC,
  created_at DESC
        `);


      res.json(rows);


    } catch (e) {

      console.error(
        "Error obteniendo galería pública:",
        e
      );


      res.status(500).json({

        error:
          "No se pudieron cargar los trabajos."

      });

    }

  }
);


// =========================================================
// ADMIN - GALERÍA
// =========================================================

app.get(
  "/api/admin/gallery",
  requireAdmin,
  async (req, res) => {

    try {

      const [rows] =
        await pool.query(`
          SELECT
  id,
  title,
  description,
  image_url,
  active,
  featured,
  sort_order,
  created_at
FROM gallery
ORDER BY
  sort_order ASC,
  created_at DESC
        `);


      res.json(rows);


    } catch (e) {

      console.error(
        "Error obteniendo galería admin:",
        e
      );


      res.status(500).json({

        error:
          "No se pudieron cargar los trabajos."

      });

    }

  }
);


// =========================================================
// AGREGAR TRABAJO
// =========================================================

app.post(
  "/api/admin/gallery",
  requireAdmin,
  upload.single("image"),
  validateUploadedImage,
  async (req, res) => {

    try {

      const title =
        String(
          req.body.title || ""
        ).trim();


      const description =
        String(
          req.body.description || ""
        ).trim();


      const active =
        req.body.active === "true" ||
        req.body.active === "1"
          ? 1
          : 0;
      const featured =
  req.body.featured === "true" ||
  req.body.featured === "1"
    ? 1
    : 0;

      if (!title) {

        if (req.file) {

          fs.unlinkSync(
            req.file.path
          );

        }


        return res.status(400).json({

          error:
            "El título es obligatorio."

        });

      }

      if (title.length > 150) {

        if (req.file) {

          fs.unlinkSync(
            req.file.path
          );

        }


        return res.status(400).json({

          error:
            "El título es demasiado largo."

        });

      }


      if (description.length > 500) {

        if (req.file) {

          fs.unlinkSync(
            req.file.path
          );

        }


        return res.status(400).json({

          error:
            "La descripción es demasiado larga."

        });

      }


      if (!req.file) {

        return res.status(400).json({

          error:
            "Debes seleccionar una imagen."

        });

      }


      const imageUrl =
        "/uploads/" +
        req.file.filename;
		const [orderRows] = await pool.query(
  `
  SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
  FROM gallery
  `
);

const sortOrder =
  orderRows[0].next_order;
if (featured) {
  await pool.query(
    `
    UPDATE gallery
    SET featured=0
    WHERE featured=1
    `
  );
}

      await pool.query(
        `
        INSERT INTO gallery
        (
          title,
          description,
          image_url,
          active,
		  featured,
		  sort_order
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          title,
          description,
          imageUrl,
          active,
          featured,
          sortOrder
        ]
      );


      res.json({

        ok: true,

        message:
          "Trabajo agregado correctamente.",

        image_url:
          imageUrl

      });


    } catch (e) {

      if (req.file) {

        try {

          fs.unlinkSync(
            req.file.path
          );

        } catch {}

      }


      console.error(
        "Error agregando trabajo:",
        e
      );


      res.status(500).json({

        error:
          "No se pudo agregar el trabajo."

      });

    }

  }
);


// =========================================================
// EDITAR TRABAJO
// =========================================================

app.put(
  "/api/admin/gallery/:id",
  requireAdmin,
  upload.single("image"),
  validateUploadedImage,
  async (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );


      if (!Number.isInteger(id)) {

        if (req.file) {

          fs.unlinkSync(
            req.file.path
          );

        }


        return res.status(400).json({

          error:
            "ID inválido."

        });

      }


      const title =
        String(
          req.body.title || ""
        ).trim();


      const description =
        String(
          req.body.description || ""
        ).trim();


      const active =
        req.body.active === "true" ||
        req.body.active === "1"
          ? 1
          : 0;
      const featured =
  req.body.featured === "true" ||
  req.body.featured === "1"
    ? 1
    : 0;

      if (!title) {

        if (req.file) {

          fs.unlinkSync(
            req.file.path
          );

        }


        return res.status(400).json({

          error:
            "El título es obligatorio."

        });

      }


      if (title.length > 150) {

        if (req.file) {

          fs.unlinkSync(
            req.file.path
          );

        }


        return res.status(400).json({

          error:
            "El título es demasiado largo."

        });

      }


      if (description.length > 500) {

        if (req.file) {

          fs.unlinkSync(
            req.file.path
          );

        }


        return res.status(400).json({

          error:
            "La descripción es demasiado larga."

        });

      }


      const [rows] =
        await pool.query(
          `
          SELECT
            image_url
          FROM gallery
          WHERE id=?
          LIMIT 1
          `,
          [
            id
          ]
        );


      if (!rows.length) {

        if (req.file) {

          fs.unlinkSync(
            req.file.path
          );

        }


        return res.status(404).json({

          error:
            "Trabajo no encontrado."

        });

      }


      let imageUrl =
        rows[0].image_url;


      if (req.file) {

        imageUrl =
          "/uploads/" +
          req.file.filename;

      }
if (featured) {
  await pool.query(
    `
    UPDATE gallery
    SET featured=0
    WHERE featured=1
      AND id<>?
    `,
    [id]
  );
}

      await pool.query(
        `
        UPDATE gallery
        SET
          title=?,
          description=?,
          image_url=?,
          active=?,
		  featured=?
        WHERE id=?
        `,
        [
          title,
          description,
          imageUrl,
          active,
		  featured,
          id
        ]
      );


      if (
        req.file &&
        rows[0].image_url
      ) {

        const oldFile =
          path.join(
            __dirname,
            "public",
            rows[0].image_url
              .replace(/^\/+/, "")
          );


        if (fs.existsSync(oldFile)) {

          try {

            fs.unlinkSync(
              oldFile
            );

          } catch (err) {

            console.error(
              "No se pudo eliminar imagen anterior:",
              err.message
            );

          }

        }

      }


      res.json({

        ok: true,

        message:
          "Trabajo actualizado correctamente."

      });


    } catch (e) {

      if (req.file) {

        try {

          fs.unlinkSync(
            req.file.path
          );

        } catch {}

      }


      console.error(
        "Error editando trabajo:",
        e
      );


      res.status(500).json({

        error:
          "No se pudo actualizar el trabajo."

      });

    }

  }
);


// =========================================================
// ELIMINAR TRABAJO
// =========================================================

app.delete(
  "/api/admin/gallery/:id",
  requireAdmin,
  async (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );


      if (!Number.isInteger(id)) {

        return res.status(400).json({

          error:
            "ID inválido."

        });

      }


      const [rows] =
        await pool.query(
          `
          SELECT
            image_url
          FROM gallery
          WHERE id=?
          LIMIT 1
          `,
          [
            id
          ]
        );


      if (!rows.length) {

        return res.status(404).json({

          error:
            "Trabajo no encontrado."

        });

      }


      await pool.query(
        `
        DELETE FROM gallery
        WHERE id=?
        `,
        [
          id
        ]
      );

      if (rows[0].image_url) {

        const imageFile =
          path.join(
            __dirname,
            "public",
            rows[0].image_url
              .replace(/^\/+/, "")
          );


        if (fs.existsSync(imageFile)) {

          try {

            fs.unlinkSync(
              imageFile
            );

          } catch (err) {

            console.error(
              "No se pudo eliminar imagen:",
              err.message
            );

          }

        }

      }


      res.json({

        ok: true,

        message:
          "Trabajo eliminado correctamente."

      });


    } catch (e) {

      console.error(
        "Error eliminando trabajo:",
        e
      );


      res.status(500).json({

        error:
          "No se pudo eliminar el trabajo."

      });

    }

  }
);

app.put(
  "/api/admin/gallery/:id/order",
  requireAdmin,
  async (req, res) => {

    try {

      const id =
        Number(req.params.id);

      const direction =
        req.body.direction;

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          error: "ID inválido."
        });
      }

      if (
        direction !== "up" &&
        direction !== "down"
      ) {
        return res.status(400).json({
          error: "Dirección inválida."
        });
      }

      const [rows] =
        await pool.query(
          `
          SELECT
            id,
            sort_order
          FROM gallery
          WHERE id=?
          LIMIT 1
          `,
          [id]
        );

      if (!rows.length) {
        return res.status(404).json({
          error: "Trabajo no encontrado."
        });
      }

      const current =
        rows[0];

      let comparison;
      let orderDirection;

      if (direction === "up") {

        comparison = "<";
        orderDirection = "DESC";

      } else {

        comparison = ">";
        orderDirection = "ASC";

      }

      const [neighbors] =
        await pool.query(
          `
          SELECT
            id,
            sort_order
          FROM gallery
          WHERE sort_order ${comparison} ?
          ORDER BY sort_order ${orderDirection}
          LIMIT 1
          `,
          [current.sort_order]
        );

      if (!neighbors.length) {
        return res.json({
          ok: true,
          message:
            direction === "up"
              ? "Ya está primero."
              : "Ya está último."
        });
      }

      const neighbor =
        neighbors[0];

      await pool.query(
        `
        UPDATE gallery
        SET sort_order=?
        WHERE id=?
        `,
        [
          neighbor.sort_order,
          current.id
        ]
      );

      await pool.query(
        `
        UPDATE gallery
        SET sort_order=?
        WHERE id=?
        `,
        [
          current.sort_order,
          neighbor.id
        ]
      );

      res.json({
        ok: true,
        message:
          "Orden actualizado correctamente."
      });

    } catch (e) {

      console.error(
        "Error cambiando orden de galería:",
        e
      );

      res.status(500).json({
        error:
          "No se pudo cambiar el orden."
      });

    }

  }
);
// =========================================================
// SERVICIOS PÚBLICOS
// =========================================================

app.get(
  "/api/services",
  async (req, res) => {

    try {

      const [rows] =
        await pool.query(
          `
          SELECT
            id,
            title,
            description,
            price,
            category,
            sort_order
          FROM services
          WHERE active=1
          ORDER BY sort_order ASC, id ASC
          `
        );


      res.json(rows);


    } catch (e) {

      console.error(
        "Error obteniendo servicios:",
        e
      );


      res.status(500).json({

        error:
          "No se pudieron cargar los servicios."

      });

    }

  }
);


// =========================================================
// ADMIN - USUARIOS
// =========================================================

app.get(
  "/api/admin/users",
  requireAdmin,
  async (req, res) => {

    try {

      const [rows] =
        await pool.query(
          `
          SELECT
            id,
            name,
            email,
            role,
            created_at
          FROM users
          ORDER BY created_at DESC
          `
        );


      res.json(rows);


    } catch (e) {

      console.error(e);

      res.status(500).json({

        error:
          "No se pudieron cargar los usuarios."

      });

    }

  }
);


// =========================================================
// ADMIN - CLIENTES
// =========================================================

app.get(
  "/api/admin/clients",
  requireAdmin,
  async (req, res) => {
    try {
      const search = String(req.query.search || "").trim();

      let sql = `
        SELECT
          COALESCE(
            MAX(NULLIF(TRIM(u.name), "")),
            MAX(NULLIF(TRIM(qr.name), ""))
          ) AS name,
          COALESCE(
            MAX(NULLIF(TRIM(u.email), "")),
            MAX(NULLIF(TRIM(qr.email), ""))
          ) AS email,
          qr.phone,
          COUNT(DISTINCT qr.id) AS requests,
          COUNT(DISTINCT q.id) AS quotes,
          MAX(qr.created_at) AS last_request,
          MAX(COALESCE(q.updated_at, qr.created_at)) AS last_activity
        FROM quote_requests qr
        LEFT JOIN quotes q
          ON q.quote_request_id = qr.id
        LEFT JOIN users u
          ON u.email = qr.email
        WHERE 1=1
      `;

      const params = [];

      if (search) {
        sql += `
          AND (
            qr.name LIKE ?
            OR qr.phone LIKE ?
            OR qr.email LIKE ?
            OR u.name LIKE ?
            OR u.email LIKE ?
          )
        `;

        const value = `%${search}%`;
        params.push(value, value, value, value, value);
      }

      sql += `
        GROUP BY
          qr.phone,
          COALESCE(NULLIF(LOWER(TRIM(qr.email)), ""), "")
        ORDER BY last_activity DESC, name ASC
      `;

      const [rows] = await pool.query(sql, params);

      res.json({
        success: true,
        clients: rows.map(client => ({
          ...client,
          requests: Number(client.requests || 0),
          quotes: Number(client.quotes || 0)
        }))
      });

    } catch (error) {
      console.error("Error obteniendo clientes:", error);

      res.status(500).json({
        error: "No se pudieron obtener los clientes."
      });
    }
  }
);


// =========================================================
// ADMIN - CLIENTE: FICHA DETALLADA
// =========================================================

app.get(
  "/api/admin/clients/detail",
  requireAdmin,
  async (req, res) => {
    try {
      const phone = String(req.query.phone || "").trim();
      const email = String(req.query.email || "").trim().toLowerCase();

      if (!phone) {
        return res.status(400).json({
          error: "El teléfono del cliente es obligatorio."
        });
      }

      const [requests] = await pool.query(
        `
        SELECT
          id,
          name,
          phone,
          email,
          service,
          description,
          preferred_date,
          image_url,
          status,
          created_at
        FROM quote_requests
        WHERE phone = ?
          AND (
            (? = "" AND (email IS NULL OR email = ""))
            OR (? <> "" AND LOWER(COALESCE(email, "")) = ?)
          )
        ORDER BY created_at DESC
        `,
        [phone, email, email, email]
      );

      if (!requests.length) {
        return res.status(404).json({
          error: "No se encontró el cliente."
        });
      }

      const [quotes] = await pool.query(
        `
        SELECT
          q.id,
          q.quote_number,
          q.issue_date,
          q.expiration_date,
          q.status,
          q.subtotal,
          q.discount,
          q.total,
          q.created_at,
          q.updated_at,
          j.id AS job_id,
          j.status AS job_status,
          j.started_at,
          j.completed_at
        FROM quotes q
        INNER JOIN quote_requests qr
          ON qr.id = q.quote_request_id
        LEFT JOIN jobs j
          ON j.quote_id = q.id
        WHERE qr.phone = ?
          AND (
            (? = "" AND (qr.email IS NULL OR qr.email = ""))
            OR (? <> "" AND LOWER(COALESCE(qr.email, "")) = ?)
          )
        ORDER BY q.created_at DESC
        `,
        [phone, email, email, email]
      );

      const client = {
        name: requests[0].name || "Sin nombre",
        phone: requests[0].phone || phone,
        email: requests[0].email || email || "",
        requests: requests.length,
        quotes: quotes.length,
        totalQuoted: quotes.reduce(
          (sum, quote) => sum + Number(quote.total || 0),
          0
        ),
        totalJobs: quotes.filter(quote => quote.job_id).length,
        completedJobs: quotes.filter(
          quote => quote.job_status === "cerrado"
        ).length,
        lastActivity: requests.reduce((latest, item) => {
          const value = new Date(item.created_at).getTime();
          return value > latest ? value : latest;
        }, 0)
      };

      res.json({
        success: true,
        client,
        requests,
        quotes
      });

    } catch (error) {
      console.error("Error obteniendo ficha del cliente:", error);

      res.status(500).json({
        error: "No se pudo obtener la ficha del cliente."
      });
    }
  }
);


// =========================================================
// ADMIN - ESTADÍSTICAS
// =========================================================

// =========================================================
// ADMIN - ESTADÍSTICAS DEL DASHBOARD
// =========================================================

app.get(
  "/api/admin/stats",
  requireAdmin,
  async (req, res) => {
    try {
      const daysRaw = Number(req.query.days || 30);
      const days = [7, 30, 90, 365].includes(daysRaw) ? daysRaw : 30;

      const [[users]] = await pool.query("SELECT COUNT(*) AS total FROM users");
      const [[services]] = await pool.query("SELECT COUNT(*) AS total FROM services");
      const [[activeServices]] = await pool.query("SELECT COUNT(*) AS total FROM services WHERE active=1");
      const [[pendingRequests]] = await pool.query("SELECT COUNT(*) AS total FROM quote_requests WHERE status='pendiente'");
      const [[totalRequests]] = await pool.query("SELECT COUNT(*) AS total FROM quote_requests");
      const [[acceptedQuotes]] = await pool.query("SELECT COUNT(*) AS total FROM quotes WHERE status='aceptado'");
      const [[sentQuotes]] = await pool.query("SELECT COUNT(*) AS total FROM quotes WHERE status='enviado'");
      const [[rejectedQuotes]] = await pool.query("SELECT COUNT(*) AS total FROM quotes WHERE status='rechazado'");
      const [[expiredQuotes]] = await pool.query("SELECT COUNT(*) AS total FROM quotes WHERE status='vencido'");
      const [[jobsInProgress]] = await pool.query("SELECT COUNT(*) AS total FROM jobs WHERE status='en_proceso'");
      const [[completedJobs]] = await pool.query("SELECT COUNT(*) AS total FROM jobs WHERE status='cerrado'");

      const [[financial]] = await pool.query(
        `SELECT
          COALESCE(SUM(CASE WHEN status='aceptado' THEN total ELSE 0 END),0) AS acceptedAmount,
          COALESCE(SUM(CASE WHEN status='enviado' THEN total ELSE 0 END),0) AS pendingAmount,
          COALESCE(SUM(CASE WHEN status='rechazado' THEN total ELSE 0 END),0) AS rejectedAmount
        FROM quotes`
      );

      const [monthly] = await pool.query(
        `SELECT DATE_FORMAT(COALESCE(issue_date, created_at),'%Y-%m') AS month,
                COUNT(*) AS quotes,
                COALESCE(SUM(total),0) AS amount
         FROM quotes
         WHERE COALESCE(issue_date, created_at) >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)
         GROUP BY DATE_FORMAT(COALESCE(issue_date, created_at),'%Y-%m')
         ORDER BY month ASC`
      );

      const [recentActivity] = await pool.query(
        `SELECT 'solicitud' AS type, id, name AS title, service AS detail, created_at AS date
         FROM quote_requests
         ORDER BY created_at DESC LIMIT 5`
      );

      const [periodQuotes] = await pool.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS amount
         FROM quotes
         WHERE COALESCE(issue_date, created_at) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
        [days]
      );

      const [periodJobs] = await pool.query(
        `SELECT COUNT(*) AS count
         FROM jobs
         WHERE COALESCE(completed_at, started_at, created_at) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
        [days]
      );

      res.json({
        users: Number(users.total),
        services: Number(services.total),
        activeServices: Number(activeServices.total),
        pendingRequests: Number(pendingRequests.total),
        totalRequests: Number(totalRequests.total),
        acceptedQuotes: Number(acceptedQuotes.total),
        sentQuotes: Number(sentQuotes.total),
        rejectedQuotes: Number(rejectedQuotes.total),
        expiredQuotes: Number(expiredQuotes.total),
        jobsInProgress: Number(jobsInProgress.total),
        completedJobs: Number(completedJobs.total),
        acceptedAmount: Number(financial.acceptedAmount || 0),
        pendingAmount: Number(financial.pendingAmount || 0),
        rejectedAmount: Number(financial.rejectedAmount || 0),
        period: {
          days,
          quotes: Number(periodQuotes[0]?.count || 0),
          amount: Number(periodQuotes[0]?.amount || 0),
          jobs: Number(periodJobs[0]?.count || 0)
        },
        monthly: monthly.map(row => ({
          month: row.month,
          quotes: Number(row.quotes || 0),
          amount: Number(row.amount || 0)
        })),
        recentActivity
      });
    } catch (e) {
      console.error("Error obteniendo estadísticas:", e);
      res.status(500).json({ error: "No se pudieron obtener las estadísticas." });
    }
  }
);

// =========================================================
// ADMIN - CONFIGURACIÓN DE CUENTA
// =========================================================

// Obtener datos de la cuenta del administrador
app.get(
  "/api/admin/account",
  requireAdmin,
  async (req, res) => {
    try {
      const userId = req.session.user.id;

      const [[user]] = await pool.query(
        `
        SELECT
          id,
          name,
          email,
          role,
          created_at
        FROM users
        WHERE id = ?
        LIMIT 1
        `,
        [userId]
      );

      if (!user) {
        return res.status(404).json({
          error: "Usuario no encontrado."
        });
      }

      res.json({
        user
      });

    } catch (e) {
      console.error(
        "Error obteniendo datos de la cuenta:",
        e
      );

      res.status(500).json({
        error:          "No se pudieron obtener los datos de la cuenta."
      });
    }
  }
);


// Actualizar nombre y email
app.put(
  "/api/admin/account",
  requireAdmin,
  async (req, res) => {
    try {
      const userId = req.session.user.id;

      const name = String(
        req.body.name || ""
      ).trim();

      const email = String(
        req.body.email || ""
      ).trim().toLowerCase();

      if (!name) {
        return res.status(400).json({
          error: "El nombre es obligatorio."
        });
      }

      if (!email) {
        return res.status(400).json({
          error: "El email es obligatorio."
        });
      }

      const emailRegex =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailRegex.test(email)) {
        return res.status(400).json({
          error: "El email no es válido."
        });
      }

      const [[existing]] = await pool.query(
        `
        SELECT
          id
        FROM users
        WHERE email = ?
          AND id <> ?
        LIMIT 1
        `,
        [email, userId]
      );

      if (existing) {
        return res.status(409).json({
          error:
            "Ese email ya está registrado por otro usuario."
        });
      }

      await pool.query(
        `
        UPDATE users
        SET
          name = ?,
          email = ?
        WHERE id = ?
        `,
        [
          name,
          email,
          userId
        ]
      );

// Actualizar también los datos guardados
// en la sesión actual, si existen.
if (req.session.user) {
  req.session.user.name = name;
  req.session.user.email = email;
}

      res.json({
        success: true,
        message:
          "Los datos de la cuenta fueron actualizados."
      });

    } catch (e) {
      console.error(
        "Error actualizando cuenta:",
        e
      );

      res.status(500).json({
        error:
          "No se pudieron actualizar los datos."
      });
    }
  }
);


// Cambiar contraseña
app.put(
  "/api/admin/account/password",
  requireAdmin,
  async (req, res) => {
    try {
      const userId = req.session.user.id;

      const currentPassword =
        String(
          req.body.currentPassword || ""
        );

      const newPassword =
        String(
          req.body.newPassword || ""
        );

      if (!currentPassword) {
        return res.status(400).json({
          error:
            "Ingresá tu contraseña actual."
        });
      }

      if (
        newPassword.length < 8 ||
        newPassword.length > 200
      ) {
        return res.status(400).json({
          error:
            "La nueva contraseña debe tener entre 8 y 200 caracteres."
        });
      }

      const [[user]] = await pool.query(
        `
        SELECT
          id,
          password_hash
        FROM users
        WHERE id = ?
        LIMIT 1
        `,
        [userId]
      );

      if (!user) {
        return res.status(404).json({
          error: "Usuario no encontrado."
        });
      }

      const validPassword =
        await bcrypt.compare(
          currentPassword,
          user.password_hash
        );

      if (!validPassword) {
        return res.status(401).json({
          error:
            "La contraseña actual es incorrecta."
        });
      }

      const newPasswordHash =
        await bcrypt.hash(
          newPassword,
          12
        );

      await pool.query(
        `
        UPDATE users
        SET password_hash = ?
        WHERE id = ?
        `,
        [
          newPasswordHash,
          userId
        ]
      );

      // Mantener esta sesión y cerrar todas las demás sesiones del administrador.
      await invalidateUserSessions(
        userId,
        req.sessionID
      );

      res.json({
        success: true,
        message:
          "La contraseña fue cambiada correctamente. Las demás sesiones fueron cerradas."
      });

    } catch (e) {
      console.error(
        "Error cambiando contraseña:",
        e
      );

      res.status(500).json({
        error:
          "No se pudo cambiar la contraseña."
      });
    }
  }
);
// =========================================================
// ADMIN - SERVICIOS
// =========================================================

app.get(
  "/api/admin/services",
  requireAdmin,
  async (req, res) => {

    try {

      const [rows] =
        await pool.query(
          `
          SELECT
            id,
            title,
            description,
            price,
            active,
            category,
            sort_order
          FROM services
          ORDER BY sort_order ASC, id ASC
          `
        );


      res.json(rows);


    } catch (e) {

      console.error(e);

      res.status(500).json({

        error:
          "No se pudieron cargar los servicios."

      });

    }

  }
);


app.post(
  "/api/admin/services",
  requireAdmin,
  async (req, res) => {

    try {

      const title =
        String(
          req.body.title || ""
        ).trim();


      const description =
        String(
          req.body.description || ""
        ).trim();

      const category = String(req.body.category || "").trim();
      const rawOrder =
        req.body.sort_order === "" || req.body.sort_order == null
          ? null
          : Number(req.body.sort_order);

      const rawPrice =
        req.body.price;


      const price =
        rawPrice === "" ||
        rawPrice === null ||
        rawPrice === undefined
          ? null
          : Number(rawPrice);


      if (!title) {

        return res.status(400).json({

          error:
            "El título es obligatorio."

        });

      }


      if (title.length > 120) {

        return res.status(400).json({

          error:
            "El título es demasiado largo."

        });

      }


      if (description.length > 1000) {

        return res.status(400).json({

          error:
            "La descripción es demasiado larga."

        });

      }


      if (category.length > 100) {
        return res.status(400).json({
          error: "La categoría es demasiado larga."
        });
      }

      if (rawOrder !== null && (!Number.isInteger(rawOrder) || rawOrder < 0 || rawOrder > 1000000)) {
        return res.status(400).json({
          error: "El orden no es válido."
        });
      }

      if (
        price !== null &&
        (
          !Number.isFinite(price) ||
          price < 0 ||
          price > 1000000000
        )
      ) {

        return res.status(400).json({

          error:
            "El precio no es válido."

        });

      }


      await pool.query(
        `
        INSERT INTO services
        (
          title,
          description,
          price,
          category,
          sort_order
        )
        VALUES
        (
          ?,
          ?,
          ?,
          ?,
          COALESCE(?, 0)
        )
        `,
        [
          title,
          description,
          price,
          category,
          rawOrder
        ]
      );


      res.json({
        ok: true
      });


    } catch (e) {

      console.error(e);

      res.status(500).json({

        error:
          "No se pudo crear el servicio."

      });

    }

  }
);


app.put(
  "/api/admin/services/:id",
  requireAdmin,
  async (req, res) => {

    try {

      const serviceId = Number(req.params.id);
      if (!Number.isInteger(serviceId) || serviceId <= 0) {
        return res.status(400).json({ error: "ID de servicio inválido." });
      }

      const title =
        String(
          req.body.title || ""
        ).trim();


      const description =
        String(
          req.body.description || ""
        ).trim();

      const category = String(req.body.category || "").trim();
      const rawOrder =
        req.body.sort_order === "" || req.body.sort_order == null
          ? null
          : Number(req.body.sort_order);

      const rawPrice =
        req.body.price;


      const price =
        rawPrice === "" ||
        rawPrice === null ||
        rawPrice === undefined
          ? null
          : Number(rawPrice);


      const active =
        req.body.active
          ? 1
          : 0;


      if (!title) {

        return res.status(400).json({

          error:
            "El título es obligatorio."

        });

      }


      if (title.length > 120) {

        return res.status(400).json({

          error:
            "El título es demasiado largo."

        });

      }


      if (description.length > 1000) {

        return res.status(400).json({

          error:
            "La descripción es demasiado larga."

        });

      }


      if (category.length > 100) {
        return res.status(400).json({
          error: "La categoría es demasiado larga."
        });
      }

      if (rawOrder !== null && (!Number.isInteger(rawOrder) || rawOrder < 0 || rawOrder > 1000000)) {
        return res.status(400).json({
          error: "El orden no es válido."
        });
      }

      if (
        price !== null &&
        (
          !Number.isFinite(price) ||
          price < 0 ||
          price > 1000000000
        )
      ) {

        return res.status(400).json({

          error:
            "El precio no es válido."

        });

      }


      const [result] =
        await pool.query(
          `
          UPDATE services
          SET
            title=?,
            description=?,
            price=?,
            active=?,
            category=?,
            sort_order=COALESCE(?, sort_order)
          WHERE id=?
          `,
          [
            title,
            description,
            price,
            active,
            category,
            rawOrder,
            serviceId
          ]
        );


      if (!result.affectedRows) {

        return res.status(404).json({
          error:
            "Servicio no encontrado."

        });

      }


      res.json({
        ok: true
      });


    } catch (e) {

      console.error(e);

      res.status(500).json({

        error:
          "No se pudo actualizar el servicio."

      });

    }

  }
);


app.delete(
  "/api/admin/services/:id",
  requireAdmin,
  async (req, res) => {

    try {

      const serviceId = Number(req.params.id);
      if (!Number.isInteger(serviceId) || serviceId <= 0) {
        return res.status(400).json({ error: "ID de servicio inválido." });
      }

      const [result] =
        await pool.query(
          `
          DELETE FROM services
          WHERE id=?
          `,
          [serviceId]
        );


      if (!result.affectedRows) {

        return res.status(404).json({

          error:
            "Servicio no encontrado."

        });

      }


      res.json({
        ok: true
      });


    } catch (e) {

      console.error(e);

      res.status(500).json({

        error:
          "No se pudo eliminar el servicio."

      });

    }

  }
);


// =========================================================
// ADMIN - ORDENAR SERVICIOS
// =========================================================
app.put(
  "/api/admin/services/:id/order",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const direction = req.body.direction;

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "ID de servicio inválido." });
      }

      if (direction !== "up" && direction !== "down") {
        return res.status(400).json({ error: "Dirección inválida." });
      }

      const [[current]] = await pool.query(
        "SELECT id, sort_order FROM services WHERE id=? LIMIT 1",
        [id]
      );

      if (!current) {
        return res.status(404).json({ error: "Servicio no encontrado." });
      }

      const comparison = direction === "up" ? "<" : ">";
      const orderDirection = direction === "up" ? "DESC" : "ASC";

      const [neighbors] = await pool.query(
        `SELECT id, sort_order FROM services
         WHERE sort_order ${comparison} ?
         ORDER BY sort_order ${orderDirection}, id ${orderDirection}
         LIMIT 1`,
        [current.sort_order]
      );

      if (!neighbors.length) {
        return res.json({
          ok: true,
          message: direction === "up" ? "Ya está primero." : "Ya está último."
        });
      }

      const neighbor = neighbors[0];

      await pool.query("UPDATE services SET sort_order=? WHERE id=?", [neighbor.sort_order, current.id]);
      await pool.query("UPDATE services SET sort_order=? WHERE id=?", [current.sort_order, neighbor.id]);

      res.json({ ok: true, message: "Orden de servicios actualizado." });
    } catch (error) {
      console.error("Error ordenando servicios:", error);
      res.status(500).json({ error: "No se pudo cambiar el orden." });
    }
  }
);

// =========================================================
// ADMIN - CAMBIAR ROL
// =========================================================

app.put(
  "/api/admin/users/:id/role",
  requireAdmin,
  authLimiter,
  async (req, res) => {

    try {

      const userId = Number(req.params.id);
      const role = req.body.role;

      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({
          error: "ID de usuario inválido."
        });
      }

      if (
        !["user", "admin"]
          .includes(role)
      ) {

        return res.status(400).json({

          error:
            "Rol inválido."

        });

      }


      if (
        Number(
          req.params.id
        ) ===
        Number(
          req.session.user.id
        ) &&
        role !== "admin"
      ) {

        return res.status(400).json({

          error:
            "No puedes quitarte tu propio rol de administrador."

        });

      }


      const [result] =
        await pool.query(
          `
          UPDATE users
          SET role=?
          WHERE id=?
          `,
          [
            role,
            req.params.id
          ]
        );


      if (!result.affectedRows) {

        return res.status(404).json({

          error:
            "Usuario no encontrado."

        });

      }

      // El cambio de rol invalida las sesiones existentes
      // para que el permiso efectivo coincida con el rol actual.
      await invalidateUserSessions(userId);

      res.json({
        ok: true
      });


    } catch (e) {

      console.error(e);

      res.status(500).json({

        error:
          "No se pudo cambiar el rol."

      });

    }

  }
);


// =========================================================
// ADMIN - ELIMINAR USUARIO
// =========================================================

app.delete(
  "/api/admin/users/:id",
  requireAdmin,
  async (req, res) => {

    try {

      const userId = Number(req.params.id);

      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({
          error: "ID de usuario inválido."
        });
      }

      if (userId === Number(req.session.user.id)) {

        return res.status(400).json({

          error:
            "No puedes eliminar tu propia cuenta desde el panel."

        });

      }

      const [result] =
        await pool.query(
          `
          DELETE FROM users
          WHERE id=?
          `,
          [
            userId
          ]
        );

      if (!result.affectedRows) {

        return res.status(404).json({

          error:
            "Usuario no encontrado."

        });

      }

      // El usuario eliminado no puede conservar sesiones válidas.
      await invalidateUserSessions(userId);

      res.json({
        ok: true
      });

    } catch (e) {

      console.error(e);

      res.status(500).json({

        error:
          "No se pudo eliminar el usuario."

      });

    }

  }
);


// =========================================================
// PANEL DE ADMINISTRACIÓN
// =========================================================

app.get(
  "/admin",
  requireAdmin,
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin.html"
      )
    );

  }
);


// =========================================================
 // VALIDACIÓN DE CONFIGURACIÓN
 // =========================================================

function validateProductionConfig() {
  const required = [
    "DB_HOST",
    "DB_USER",
    "DB_NAME",
    "SESSION_SECRET"
  ];

  const missing = required.filter(key => !String(process.env[key] || "").trim());

  if (missing.length) {
    throw new Error(
      "Faltan variables de entorno obligatorias: " + missing.join(", ")
    );
  }

  if (
    String(process.env.NODE_ENV || "").toLowerCase() === "production" &&
    !String(process.env.APP_URL || "").trim()
  ) {
    throw new Error(
      "APP_URL es obligatoria cuando NODE_ENV=production."
    );
  }
}

// =========================================================
// INICIAR SERVIDOR
// =========================================================

async function start() {
  validateProductionConfig();
  await runMigrations(pool);
  await ensureBusinessSettingsTable();
  await ensureServiceColumns();
  await ensureNotificationSchema();


  try {

    await pool.query(
      "SELECT 1"
    );


    console.log(
      "✅ MySQL conectado"
    );
	// =====================================================
// GESTIÓN DE TRABAJOS - ADMIN
// =====================================================

// Listar trabajos con búsqueda y filtros
app.get("/api/admin/jobs", requireAdmin, async (req, res) => {
  try {
    const {
      search = "",
      status = "",
      date_from = "",
      date_to = ""
    } = req.query;

    let sql = `
      SELECT
        j.id,
        j.quote_id,
        j.status,
        j.started_at,
        j.completed_at,
        j.created_at,
        j.updated_at,

        q.quote_number,
        q.issue_date,
        q.expiration_date,
        q.subtotal,
        q.discount,
        q.total,
        q.notes,

        qr.name AS client_name,
        qr.phone AS client_phone,
        qr.email AS client_email,
        qr.service AS requested_service,
        qr.description AS work_description,
        qr.preferred_date,
        qr.image_url

      FROM jobs j

      INNER JOIN quotes q
        ON q.id = j.quote_id

      INNER JOIN quote_requests qr
        ON qr.id = q.quote_request_id

      WHERE 1 = 1
    `;

    const params = [];

    // Buscar por cliente, teléfono o presupuesto
    if (search.trim()) {
      sql += `
        AND (
          qr.name LIKE ?
          OR qr.phone LIKE ?
          OR q.quote_number LIKE ?
        )
      `;

      const searchValue = `%${search.trim()}%`;

      params.push(
        searchValue,
        searchValue,
        searchValue
      );
    }

    // Filtrar por estado
    if (status) {
      const allowedStatuses = [
        "pendiente_presupuesto",
        "presupuesto_enviado",
        "aceptado",
        "en_proceso",
        "rechazado",
        "cerrado"
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          error: "Estado de trabajo inválido."
        });
      }

      sql += ` AND j.status = ? `;
      params.push(status);
    }

    // Fecha desde
    if (date_from) {
      sql += `
        AND DATE(j.created_at) >= ?
      `;

      params.push(date_from);
    }

    // Fecha hasta
    if (date_to) {
      sql += `
        AND DATE(j.created_at) <= ?
      `;

      params.push(date_to);
    }

    sql += `
      ORDER BY j.created_at DESC, j.id DESC
    `;

    const [rows] = await pool.query(sql, params);

    res.json({
      success: true,
      jobs: rows
    });

  } catch (error) {
    console.error("Error obteniendo trabajos:", error);

    res.status(500).json({
      error: "No se pudieron obtener los trabajos."
    });
  }
});


// Obtener un trabajo específico
// =====================================================
// HISTORIAL DE TRABAJOS CERRADOS
// =====================================================

app.get("/api/admin/jobs-history", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if ((dateFrom && !dateRegex.test(dateFrom)) || (dateTo && !dateRegex.test(dateTo))) {
      return res.status(400).json({
        error: "Las fechas del historial no son válidas."
      });
    }

    if (dateFrom && dateTo && dateFrom > dateTo) {
      return res.status(400).json({
        error: "La fecha desde no puede ser posterior a la fecha hasta."
      });
    }

    let sql = `
      SELECT
        j.id,
        j.quote_id,
        j.status,
        j.started_at,
        j.completed_at,
        j.created_at,
        j.updated_at,
        q.quote_number,
        q.issue_date,
        q.subtotal,
        q.discount,
        q.total,
        q.notes,
        qr.name AS client_name,
        qr.phone AS client_phone,
        qr.email AS client_email,
        qr.service AS requested_service,
        qr.description AS work_description,
        qr.preferred_date
      FROM jobs j
      INNER JOIN quotes q ON q.id = j.quote_id
      INNER JOIN quote_requests qr ON qr.id = q.quote_request_id
      WHERE j.status = 'cerrado'
    `;

    const params = [];

    if (search) {
      sql += `
        AND (
          qr.name LIKE ?
          OR qr.phone LIKE ?
          OR qr.email LIKE ?
          OR qr.service LIKE ?
          OR q.quote_number LIKE ?
          OR qr.description LIKE ?
        )
      `;

      const value = `%${search}%`;
      params.push(value, value, value, value, value, value);
    }

    if (dateFrom) {
      sql += " AND DATE(j.completed_at) >= ?";
      params.push(dateFrom);
    }

    if (dateTo) {
      sql += " AND DATE(j.completed_at) <= ?";
      params.push(dateTo);
    }

    sql += " ORDER BY j.completed_at DESC, j.id DESC";

    const [rows] = await pool.query(sql, params);

    const total = rows.reduce(
      (sum, row) => sum + Number(row.total || 0),
      0
    );

    res.json({
      success: true,
      jobs: rows,
      summary: {
        count: rows.length,
        total
      }
    });

  } catch (error) {
    console.error("Error obteniendo historial:", error);

    res.status(500).json({
      error: "No se pudo obtener el historial de trabajos."
    });
  }
});


app.get("/api/admin/jobs/:id", requireAdmin, async (req, res) => {
  try {
    const jobId = Number(req.params.id);

    if (!Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({
        error: "ID de trabajo inválido."
      });
    }

    const [rows] = await pool.query(
      `
      SELECT
        j.id,
        j.quote_id,
        j.status,
        j.started_at,
        j.completed_at,
        j.created_at,
        j.updated_at,

        q.quote_number,
        q.issue_date,
        q.expiration_date,
        q.notes,
        q.subtotal,
        q.discount,
        q.total,

        qr.name AS client_name,
        qr.phone AS client_phone,
        qr.email AS client_email,
        qr.service AS requested_service,
        qr.description AS work_description,
        qr.preferred_date,
        qr.image_url

      FROM jobs j

      INNER JOIN quotes q
        ON q.id = j.quote_id

      INNER JOIN quote_requests qr
        ON qr.id = q.quote_request_id

      WHERE j.id = ?

      LIMIT 1
      `,
      [jobId]
    );

    if (!rows.length) {
      return res.status(404).json({
        error: "Trabajo no encontrado."
      });
    }

    const [items] = await pool.query(
      `
      SELECT
        id,
        description,
        quantity,
        unit,
        unit_price,
        total
      FROM quote_items
      WHERE quote_id = ?
      ORDER BY id ASC
      `,
      [rows[0].quote_id]
    );

    res.json({
      success: true,
      job: {
        ...rows[0],
        items
      }
    });

  } catch (error) {
    console.error("Error obteniendo trabajo:", error);

    res.status(500).json({
      error: "No se pudo obtener el trabajo."
    });
  }
});


// Cambiar estado del trabajo
app.put("/api/admin/jobs/:id/status", requireAdmin, async (req, res) => {
  try {
    const jobId = Number(req.params.id);
    const { status } = req.body;

    if (!Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({
        error: "ID de trabajo inválido."
      });
    }

    const allowedStatuses = [
      "pendiente_presupuesto",
      "presupuesto_enviado",
      "aceptado",
      "en_proceso",
      "rechazado",
      "cerrado"
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: "Estado de trabajo inválido."
      });
    }

    const [rows] = await pool.query(
      `
      SELECT
        id,
        quote_id,
        status,
        started_at,
        completed_at
      FROM jobs
      WHERE id = ?
      LIMIT 1
      `,
      [jobId]
    );

    if (!rows.length) {
      return res.status(404).json({
        error: "Trabajo no encontrado."
      });
    }

    const job = rows[0];

    // No permitir modificar un trabajo cerrado
    if (job.status === "cerrado") {
      return res.status(400).json({
        error: "Un trabajo cerrado no puede modificarse."
      });
    }

    // No permitir modificar un trabajo rechazado
    if (job.status === "rechazado") {
      return res.status(400).json({
        error: "Un trabajo rechazado no puede modificarse."
      });
    }

    // -------------------------------------------------
    // VALIDAR TRANSICIONES DE ESTADO
    // -------------------------------------------------

    const allowedTransitions = {
      pendiente_presupuesto: ["presupuesto_enviado", "rechazado"],
      presupuesto_enviado: ["aceptado", "rechazado"],
      aceptado: ["en_proceso"],
      en_proceso: ["cerrado"]
    };

    const nextStatuses = allowedTransitions[job.status] || [];

    if (!nextStatuses.includes(status)) {
      return res.status(400).json({
        error: "No se puede cambiar a ese estado desde el estado actual."
      });
    }

    // -------------------------------------------------
    // INICIAR TRABAJO
    // -------------------------------------------------

    if (status === "en_proceso") {

      if (
        job.status !== "aceptado" &&
        job.status !== "presupuesto_enviado"
      ) {
        return res.status(400).json({
          error: "El trabajo debe estar aceptado antes de iniciarlo."
        });
      }

      await pool.query(
        `
        UPDATE jobs
        SET
          status = 'en_proceso',
          started_at = COALESCE(started_at, NOW())
        WHERE id = ?
        `,
        [jobId]
      );

      await pool.query(
        `
        INSERT INTO admin_notifications (type, quote_id, message)
        VALUES ('job_started', ?, ?)
        `,
        [job.quote_id, "Se inició el trabajo asociado al presupuesto #" + job.quote_id + "."]
      );

      return res.json({
        success: true,
        status: "en_proceso",
        message: "Trabajo iniciado correctamente."
      });
    }

    // -------------------------------------------------
    // CERRAR TRABAJO
    // -------------------------------------------------

    if (status === "cerrado") {

      if (job.status !== "en_proceso") {
        return res.status(400).json({
          error: "El trabajo debe estar en proceso antes de cerrarlo."
        });
      }

      await pool.query(
        `
        UPDATE jobs
        SET
          status = 'cerrado',
          completed_at = NOW()
        WHERE id = ?
        `,
        [jobId]
      );

      await pool.query(
        `
        INSERT INTO admin_notifications (type, quote_id, message)
        VALUES ('job_closed', ?, ?)
        `,
        [job.quote_id, "Se cerró el trabajo asociado al presupuesto #" + job.quote_id + "."]
      );

      return res.json({
        success: true,
        status: "cerrado",
        message: "Trabajo cerrado correctamente."
      });
    }

    // -------------------------------------------------
    // OTROS ESTADOS ADMINISTRATIVOS
    // -------------------------------------------------

    await pool.query(
      `
      UPDATE jobs
      SET status = ?
      WHERE id = ?
      `,
      [status, jobId]
    );

    res.json({
      success: true,
      status,
      message: "Estado actualizado correctamente."
    });

  } catch (error) {
    console.error("Error actualizando estado del trabajo:", error);

    res.status(500).json({
      error: "No se pudo actualizar el estado del trabajo."
    });
  }
});
app.get("/presupuesto/:token", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "presupuesto.html")
  );
});

    app.listen(
      PORT,
      () => {

        console.log(
          `⚡ JR Electricidad: http://localhost:${PORT}`
        );

      }
    );


  } catch (e) {

    console.error(
      "❌ No se pudo conectar a MySQL:",
      e.message
    );


    process.exit(1);

  }

}
// ================================
// ADMIN
// ================================
// ========================================
// PRESUPUESTOS - ADMIN
// ========================================

// Obtener todas las solicitudes de presupuesto
app.get(
  "/api/admin/quote-requests",
  requireAdmin,
  async (req, res) => {

    try {
      const {
        search = "",
        status = "",
        date_from = "",
        date_to = ""
      } = req.query;

      const params = [];
      let sql = `
        SELECT
          id,
          name,
          phone,
          email,
          service,
          description,
          preferred_date,
          image_url,
          status,
          created_at
        FROM quote_requests
        WHERE 1=1
      `;

      const cleanSearch = String(search || "").trim();

      if (cleanSearch) {
        sql += `
          AND (
            name LIKE ?
            OR phone LIKE ?
            OR email LIKE ?
            OR service LIKE ?
            OR description LIKE ?
          )
        `;

        const value = `%${cleanSearch}%`;
        params.push(value, value, value, value, value);
      }

      const allowedStatuses = [
        "pendiente",
        "contactado",
        "presupuestado",
        "cerrado"
      ];

      if (status) {
        if (!allowedStatuses.includes(status)) {
          return res.status(400).json({
            error: "Estado de solicitud inválido."
          });
        }

        sql += " AND status = ?";
        params.push(status);
      }

      if (date_from) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date_from))) {
          return res.status(400).json({
            error: "La fecha desde no es válida."
          });
        }

        sql += " AND DATE(created_at) >= ?";
        params.push(date_from);
      }

      if (date_to) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date_to))) {
          return res.status(400).json({
            error: "La fecha hasta no es válida."
          });
        }

        sql += " AND DATE(created_at) <= ?";
        params.push(date_to);
      }

      sql += " ORDER BY created_at DESC";

      const [rows] = await pool.query(sql, params);

      res.json(rows);

    } catch (error) {

      console.error(
        "Error obteniendo solicitudes:",
        error
      );

      res.status(500).json({
        error: "No se pudieron obtener las solicitudes."
      });
    }
  }
);

app.patch(
  "/api/admin/quote-requests/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const status = String(req.body.status || "").trim();

      const allowedStatuses = [
        "pendiente",
        "contactado",
        "presupuestado",
        "cerrado"
      ];

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          error: "ID de solicitud inválido."
        });
      }

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          error: "Estado de solicitud inválido."
        });
      }

      const [result] = await pool.query(
        `
        UPDATE quote_requests
        SET status = ?
        WHERE id = ?
        `,
        [status, id]
      );

      if (!result.affectedRows) {
        return res.status(404).json({
          error: "Solicitud no encontrada."
        });
      }

      await pool.query(
        `
        INSERT INTO admin_notifications (type, quote_id, message)
        SELECT 'quote_request_status', NULL, ?
        FROM quote_requests
        WHERE id = ?
        `,
        [`La solicitud #${id} cambió al estado "${status}".`, id]
      );

      res.json({
        ok: true,
        message: "Estado de la solicitud actualizado."
      });

    } catch (error) {
      console.error(
        "Error actualizando solicitud:",
        error
      );

      res.status(500).json({
        error: "No se pudo actualizar la solicitud."
      });
    }
  }
);


// Obtener una solicitud específica
app.get(
  "/api/admin/quote-requests/:id",
  requireAdmin,
  async (req, res) => {

    try {

      const [rows] = await pool.query(
        `
        SELECT
          id,
          name,
          phone,
          email,
          service,
          description,
          preferred_date,
          image_url,
          status,
          created_at
        FROM quote_requests
        WHERE id = ?
        `,
        [req.params.id]
      );

      if (!rows.length) {

        return res.status(404).json({
          error: "Solicitud no encontrada."
        });

      }

      res.json(rows[0]);

    } catch (error) {

      console.error(
        "Error obteniendo solicitud:",
        error
      );

      res.status(500).json({
        error: "No se pudo obtener la solicitud."
      });

    }
  }
);


// =========================================================
// PRESUPUESTOS - UTILIDADES
// =========================================================

function quoteMoney(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}


function cleanQuoteItems(items) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error(
      "El presupuesto debe tener al menos un concepto."
    );
  }

  return items.map(item => {
    const description = String(
      item.description || ""
    ).trim();

    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unit_price);

    if (!description) {
      throw new Error(
        "Todos los conceptos deben tener una descripción."
      );
    }

    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 1000000 ||
      !Number.isFinite(unitPrice) ||
      unitPrice < 0 ||
      unitPrice > 1000000000 ||
      description.length > 500
    ) {
      throw new Error(
        "Las cantidades y precios deben ser valores válidos."
      );
    }

    return {
      description,
      quantity,
      unit:
        String(item.unit || "unidad").trim() ||
        "unidad",
      unit_price: unitPrice,
      total: quantity * unitPrice
    };
  });
}


// =========================================================
// OBTENER DETALLE DEL PRESUPUESTO
// =========================================================

async function getQuoteDetail(db, id) {

  // Permite usar:
  // getQuoteDetail(pool, id)
  // getQuoteDetail(connection, id)

  const [rows] = await db.query(
    `
    SELECT
      q.id,
      q.quote_request_id,
      q.quote_number,
      q.access_token,
      q.issue_date,
      q.expiration_date,
      q.notes,
      q.status,
      q.subtotal,
      q.discount,
      q.total,
      q.pdf_filename,
      q.created_at,
      qr.name,
      qr.phone,
      qr.email,
      qr.service,
      qr.description,
      qr.preferred_date,
      qr.image_url

    FROM quotes q

    INNER JOIN quote_requests qr
      ON qr.id = q.quote_request_id

    WHERE q.id = ?

    LIMIT 1
    `,
    [id]
  );

  if (!rows.length) {
    return null;
  }

  const quote = rows[0];

  const [items] = await db.query(
    `
    SELECT
      id,
      quote_id,
      description,
      quantity,
      unit,
      unit_price,
      total

    FROM quote_items

    WHERE quote_id = ?

    ORDER BY id ASC
    `,
    [id]
  );

  quote.items = items;

  return quote;
}


// =========================================================
// GENERAR PDF
// =========================================================

function buildQuotePdf(quote) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    autoFirstPage: true
  });

  const BLACK = "#080a0f";
  const DARK = "#10141c";
  const DARK2 = "#171c25";
  const YELLOW = "#ffc400";
  const ORANGE = "#ff8a00";
  const WHITE = "#ffffff";
  const TEXT = "#252a32";
  const MUTED = "#737c88";
  const LIGHT = "#f1f3f5";
  const LINE = "#d8dde3";
  const BOX_LINE = "#2a313c";
  const TITLE_LINE = "#3b424d";

  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;

  const margin = 42;
  const contentWidth = pageWidth - margin * 2;
  const right = pageWidth - margin;

  const headerHeight = 118;
  const footerHeight = 48;

  // Más cerca del encabezado
  const contentTop = 126;

  const contentBottom =
    pageHeight - footerHeight - 14;

  let y = contentTop;
  let pageNumber = 1;

  const money = value =>
    `$ ${Number(value || 0).toLocaleString("es-AR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;

  function formatDate(value) {
    if (!value) return "-";

    if (value instanceof Date) {
      const day = String(value.getUTCDate()).padStart(2, "0");
      const month = String(value.getUTCMonth() + 1).padStart(2, "0");
      const year = value.getUTCFullYear();

      return `${day}/${month}/${year}`;
    }

    const text = String(value).trim().slice(0, 10);

    const match =
      text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (match) {
      return `${match[3]}/${match[2]}/${match[1]}`;
    }

    return text;
  }

  // =========================================================
  // ENCABEZADO
  // =========================================================

  function drawHeader() {
    doc.rect(
      0,
      0,
      6,
      pageHeight
    ).fill(YELLOW);

    doc.rect(
      0,
      0,
      pageWidth,
      headerHeight
    ).fill(BLACK);

    doc.rect(
      0,
      0,
      pageWidth,
      5
    ).fill(YELLOW);

    doc.rect(
      0,
      5,
      pageWidth,
      2
    ).fill(ORANGE);

    doc.fillColor(DARK2)
      .circle(
        pageWidth - 55,
        55,
        70
      )
      .fill();

    doc.fillColor(DARK2)
      .circle(
        pageWidth - 10,
        95,
        42
      )
      .fill();

    // Rayo
    doc.fillColor(YELLOW)
      .moveTo(margin, 36)
      .lineTo(margin + 15, 14)
      .lineTo(margin + 10, 36)
      .lineTo(margin + 22, 36)
      .lineTo(margin + 3, 69)
      .lineTo(margin + 7, 45)
      .lineTo(margin - 2, 45)
      .closePath()
      .fill();

    doc.fillColor(WHITE)
      .font("Helvetica-Bold")
      .fontSize(25)
      .text(
        "JR",
        margin + 29,
        25
      );

    doc.fillColor(YELLOW)
      .font("Helvetica-Bold")
      .fontSize(15)
      .text(
        "ELECTRICIDAD",
        margin + 70,
        31
      );

    doc.fillColor("#aab2bd")
      .font("Helvetica-Bold")
      .fontSize(6.5)
      .text(
        "ELECTRICISTA MATRICULADO · CAT. 3",
        margin + 71,
        52
      );

    doc.fillColor("#7f8996")
      .font("Helvetica")
      .fontSize(6.2)
      .text(
        "Instalaciones · Reparaciones · Mantenimiento",
        margin + 71,
        65
      );

    doc.fillColor("#b8c0ca")
      .font("Helvetica")
      .fontSize(6.3)
      .text(
        "3385 684660",
        right - 160,
        27,
        {
          width: 160,
          align: "right"
        }
      );

    doc.text(
      "jorge9609@hotmail.com",
      right - 160,
      39,
      {
        width: 160,
        align: "right"
      }
    );

    const quoteBoxX = right - 185;
    const quoteBoxY = 69;

    doc.roundedRect(
      quoteBoxX,
      quoteBoxY,
      185,
      39,
      5
    ).fill(DARK2);

    doc.fillColor(YELLOW)
      .font("Helvetica-Bold")
      .fontSize(6)
      .text(
        "PRESUPUESTO",
        quoteBoxX + 11,
        quoteBoxY + 8
      );

    doc.fillColor(WHITE)
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(
        quote.quote_number || "-",
        quoteBoxX + 88,
        quoteBoxY + 7,
        {
          width: 84,
          align: "right"
        }
      );

    doc.fillColor(ORANGE)
      .font("Helvetica")
      .fontSize(5.5)
      .text(
        `Emitido ${formatDate(quote.issue_date)}`,
        quoteBoxX + 11,
        quoteBoxY + 24
      );
  }

  // =========================================================
  // PIE
  // =========================================================

  function drawFooter() {
    const footerY =
      pageHeight - footerHeight;

    doc.rect(
      0,
      footerY,
      pageWidth,
      footerHeight
    ).fill(BLACK);

    doc.fillColor(YELLOW)
      .font("Helvetica-Bold")
      .fontSize(7)
      .text(
        "JR ELECTRICIDAD",
        margin,
        footerY + 9
      );

    doc.fillColor("#8d96a2")
      .font("Helvetica")
      .fontSize(5.8)
      .text(
        "Electricista Matriculado · Cat. 3",
        margin,
        footerY + 21
      );

    doc.fillColor("#aeb6c0")
      .font("Helvetica")
      .fontSize(5.8)
      .text(
        "3385 684660  •  jorge9609@hotmail.com",
        right - 230,
        footerY + 9,
        {
          width: 230,
          align: "right"
        }
      );

    doc.fillColor(ORANGE)
      .font("Helvetica-Bold")
      .fontSize(5.5)
      .text(
        `PRESUPUESTO ${quote.quote_number || ""}`,
        right - 230,
        footerY + 21,
        {
          width: 230,
          align: "right"
        }
      );

    doc.fillColor("#707984")
      .font("Helvetica")
      .fontSize(5.2)
      .text(
        `Página ${pageNumber}`,
        right - 230,
        footerY + 33,
        {
          width: 230,
          align: "right"
        }
      );
  }

  function newPage() {
    drawFooter();

    doc.addPage();

    pageNumber++;

    drawHeader();

    y = contentTop;
  }

  function ensureSpace(height) {
    if (
      y + height >
      contentBottom
    ) {
      newPage();
    }
  }

  // =========================================================
  // TEXTO MULTIPÁGINA
  // =========================================================

  function splitTextByHeight(
    text,
    width,
    maxHeight,
    font = "Helvetica",
    fontSize = 6.8,
    lineGap = 2
  ) {
    const source =
      String(text || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");

    const paragraphs =
      source.split("\n");

    const chunks = [];

    let current = "";

    function fits(value) {
      if (!value) return true;

      const height =
        doc.heightOfString(
          value,
          {
            width,
            font,
            fontSize,
            lineGap
          }
        );

      return height <= maxHeight;
    }

    function pushCurrent() {
      const clean =
        current.trim();

      if (clean) {
        chunks.push(clean);
      }

      current = "";
    }

    for (const paragraph of paragraphs) {
      const words =
        paragraph
          .trim()
          .split(/\s+/)
          .filter(Boolean);

      if (!words.length) {
        if (current) {
          current += "\n";
        }

        continue;
      }

      for (const word of words) {
        const candidate =
          current
            ? `${current} ${word}`
            : word;

        if (fits(candidate)) {
          current = candidate;
          continue;
        }

        if (current) {
          pushCurrent();
        }

        if (!fits(word)) {
          chunks.push(word);
          current = "";
        } else {
          current = word;
        }
      }

      if (current) {
        current += "\n";
      }
    }

    pushCurrent();

    return chunks.length
      ? chunks
      : [""];
  }

  drawHeader();

  // =========================================================
  // 1. DATOS DEL CLIENTE
  // =========================================================

  // Recuadro más bajo y pegado al encabezado
  const clientBoxH = 72;

  ensureSpace(clientBoxH);

  const clientBoxY = y;

  doc.roundedRect(
    margin,
    clientBoxY,    contentWidth,
    clientBoxH,
    7
  ).fill(DARK);

  doc.roundedRect(
    margin,
    clientBoxY,
    contentWidth,
    clientBoxH,
    7
  )
    .lineWidth(0.8)
    .strokeColor(BOX_LINE)
    .stroke();

  doc.rect(
    margin,
    clientBoxY,
    contentWidth,
    3
  ).fill(YELLOW);

  // TÍTULO
  const clientTitleY =
    clientBoxY + 10;

  doc.fillColor(WHITE)
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text(
      "DATOS DEL CLIENTE",
      margin + 16,
      clientTitleY
    );

  // Línea debajo del título
  const clientLineY =
    clientBoxY + 25;

  doc.moveTo(
    margin + 16,
    clientLineY
  )
    .lineTo(
      right - 16,
      clientLineY
    )
    .strokeColor(TITLE_LINE)
    .lineWidth(0.7)
    .stroke();

  // Nombre
  doc.fillColor("#929ba7")
    .font("Helvetica-Bold")
    .fontSize(4.8)
    .text(
      "NOMBRE / RAZÓN SOCIAL",
      margin + 16,
      clientBoxY + 33
    );

  doc.fillColor(WHITE)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(
      quote.name || "-",
      margin + 16,
      clientBoxY + 43,
      {
        width: 235,
        ellipsis: true
      }
    );

  // Teléfono
  const phoneX =
    margin + 255;

  doc.fillColor("#929ba7")
    .font("Helvetica-Bold")
    .fontSize(4.8)
    .text(
      "TELÉFONO",
      phoneX,
      clientBoxY + 33
    );

  doc.fillColor(WHITE)
    .font("Helvetica")
    .fontSize(6.5)
    .text(
      quote.phone || "-",
      phoneX,
      clientBoxY + 43,
      {
        width: 90,
        ellipsis: true
      }
    );

  // Email
  const emailX =
    margin + 355;

  doc.fillColor("#929ba7")
    .font("Helvetica-Bold")
    .fontSize(4.8)
    .text(
      "EMAIL",
      emailX,
      clientBoxY + 33
    );

  doc.fillColor(WHITE)
    .font("Helvetica")
    .fontSize(6.2)
    .text(
      quote.email || "-",
      emailX,
      clientBoxY + 43,
      {
        width: 135,
        ellipsis: true
      }
    );

  // Vigencia
  doc.fillColor("#929ba7")
    .font("Helvetica-Bold")
    .fontSize(4.8)
    .text(
      "VÁLIDO HASTA",
      margin + 16,
      clientBoxY + 58
    );

  doc.fillColor(YELLOW)
    .font("Helvetica-Bold")
    .fontSize(6.5)
    .text(
      formatDate(
        quote.expiration_date
      ),
      margin + 16,
      clientBoxY + 65
    );

  // Condición
  doc.fillColor("#929ba7")
    .font("Helvetica-Bold")
    .fontSize(4.8)
    .text(
      "CONDICIÓN",
      margin + 130,
      clientBoxY + 58
    );

  doc.fillColor(ORANGE)
    .font("Helvetica-Bold")
    .fontSize(6.5)
    .text(
      "Presupuesto",
      margin + 130,
      clientBoxY + 65
    );

  y =
    clientBoxY +
    clientBoxH +
    6;

  // =========================================================
  // 2. SERVICIO + DETALLE DEL TRABAJO
  // =========================================================

  // Mucho más compacto
  const serviceBoxH = 82;

  ensureSpace(serviceBoxH);

  const serviceBoxY = y;

  doc.roundedRect(
    margin,
    serviceBoxY,
    contentWidth,
    serviceBoxH,
    7
  ).fill(BLACK);

  doc.roundedRect(
    margin,
    serviceBoxY,
    contentWidth,
    serviceBoxH,
    7
  )
    .lineWidth(0.8)
    .strokeColor(BOX_LINE)
    .stroke();

  doc.rect(
    margin,
    serviceBoxY,
    contentWidth,
    3
  ).fill(ORANGE);

  // TÍTULO GENERAL
  const serviceTitleY =
    serviceBoxY + 10;

  doc.fillColor(WHITE)
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text(
      "SERVICIO Y DETALLE DEL TRABAJO",
      margin + 16,
      serviceTitleY
    );

  // Línea debajo del título
  const serviceLineY =
    serviceBoxY + 25;

  doc.moveTo(
    margin + 16,
    serviceLineY
  )
    .lineTo(
      right - 16,
      serviceLineY
    )
    .strokeColor(TITLE_LINE)
    .lineWidth(0.7)
    .stroke();

  const innerTop =
    serviceBoxY + 33;

  const innerBottom =
    serviceBoxY +
    serviceBoxH -
    10;

  // División exacta al medio
  const centerX =
    margin +
    contentWidth / 2;

  doc.moveTo(
    centerX,
    innerTop
  )
    .lineTo(
      centerX,
      innerBottom
    )
    .strokeColor("#3a414c")
    .lineWidth(0.8)
    .stroke();

  // ---------------------------------------------------------
  // IZQUIERDA
  // ---------------------------------------------------------

  const leftX =
    margin + 16;

  const leftW =
    centerX -
    leftX -
    18;

  doc.fillColor(YELLOW)
    .font("Helvetica-Bold")
    .fontSize(5.8)
    .text(
      "TRABAJO SOLICITADO",
      leftX,
      innerTop
    );

  doc.fillColor(WHITE)
    .font("Helvetica-Bold")
    .fontSize(9.5)
    .text(
      quote.service || "-",
      leftX,
      innerTop + 12,
      {
        width: leftW,
        height: 30,
        ellipsis: true
      }
    );

  // ---------------------------------------------------------
  // DERECHA
  // ---------------------------------------------------------

  const rightColumnX =
    centerX + 18;

  const rightColumnW =
    right -
    rightColumnX -
    16;

  const description =
    String(
      quote.description || ""
    ).trim() ||
    "Sin descripción adicional.";

  doc.fillColor(YELLOW)
    .font("Helvetica-Bold")
    .fontSize(5.8)
    .text(
      "DETALLE DEL TRABAJO",
      rightColumnX,
      innerTop
    );

  doc.fillColor(WHITE)
    .font("Helvetica")
    .fontSize(6.5)
    .text(
      description,
      rightColumnX,
      innerTop + 12,
      {
        width: rightColumnW,
        height: 40,
        lineGap: 1.5,
        ellipsis: true
      }
    );

  y =
    serviceBoxY +
    serviceBoxH +
    6;

  // =========================================================
  // 3. DETALLE DEL PRESUPUESTO
  // =========================================================

  const items =
    Array.isArray(quote.items)
      ? quote.items
      : [];

  const descWidth = 270;
  const qtyWidth = 52;
  const priceWidth = 84;

  const totalWidth =
    contentWidth -
    descWidth -
    qtyWidth -
    priceWidth;

  // Encabezado mucho más bajo
  const detailHeaderH = 32;

  const detailStartY = y;

  doc.roundedRect(
    margin,
    detailStartY,
    contentWidth,
    detailHeaderH,
    7
  ).fill(DARK);

  doc.roundedRect(
    margin,
    detailStartY,
    contentWidth,
    detailHeaderH,
    7
  )
    .lineWidth(0.8)
    .strokeColor(BOX_LINE)
    .stroke();

  doc.rect(
    margin,
    detailStartY,
    contentWidth,
    3
  ).fill(YELLOW);

  const detailTitleY =
    detailStartY + 9;

  doc.fillColor(WHITE)
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text(
      "DETALLE DEL PRESUPUESTO",
      margin + 16,
      detailTitleY
    );

  doc.fillColor(ORANGE)
    .font("Helvetica-Bold")
    .fontSize(5.8)
    .text(
      `${items.length} ${
        items.length === 1
          ? "CONCEPTO"
          : "CONCEPTOS"
      }`,
      right - 85,
      detailTitleY + 1,
      {
        width: 69,
        align: "right"
      }
    );

  // Línea debajo del título
  const detailLineY =
    detailStartY + 23;

  doc.moveTo(
    margin + 16,
    detailLineY
  )
    .lineTo(
      right - 16,
      detailLineY
    )
    .strokeColor(TITLE_LINE)
    .lineWidth(0.7)
    .stroke();

  y =
    detailStartY +
    detailHeaderH;

  // =========================================================
  // CABECERA TABLA
  // =========================================================

  function drawTableHeader() {
    doc.rect(
      margin + 1,
      y,
      contentWidth - 2,
      21
    ).fill(BLACK);

    doc.fillColor(YELLOW)
      .font("Helvetica-Bold")
      .fontSize(5.5)
      .text(
        "CONCEPTO",
        margin + 11,
        y + 7
      );

    doc.fillColor(WHITE)
      .text(
        "CANT.",
        margin + descWidth,
        y + 7,
        {
          width: qtyWidth,
          align: "center"
        }
      );

    doc.text(
      "PRECIO UNIT.",
      margin +
        descWidth +
        qtyWidth,
      y + 7,
      {
        width: priceWidth,
        align: "right"
      }
    );

    doc.text(
      "TOTAL",
      margin +
        descWidth +
        qtyWidth +
        priceWidth,
      y + 7,
      {
        width: totalWidth - 10,
        align: "right"
      }
    );
    y += 21;
  }

  drawTableHeader();

  // =========================================================
  // SIN CONCEPTOS
  // =========================================================

  if (!items.length) {
    const rowH = 32;

    doc.rect(
      margin + 1,
      y,
      contentWidth - 2,
      rowH
    ).fill(LIGHT);

    doc.fillColor(MUTED)
      .font("Helvetica")
      .fontSize(6.5)
      .text(
        "No hay conceptos cargados.",
        margin + 11,
        y + 10
      );

    y += rowH;

  } else {

    // =======================================================
    // FILAS
    // =======================================================

    items.forEach(
      (item, index) => {
        const rowH = 28;

        if (
          y + rowH >
          contentBottom
        ) {
          doc.moveTo(
            margin,
            y
          )
            .lineTo(
              right,
              y
            )
            .strokeColor(BOX_LINE)
            .lineWidth(0.8)
            .stroke();

          newPage();

          const continuationY = y;

          doc.roundedRect(
            margin,
            continuationY,
            contentWidth,
            30,
            7
          ).fill(DARK);

          doc.roundedRect(
            margin,
            continuationY,
            contentWidth,
            30,
            7
          )
            .lineWidth(0.8)
            .strokeColor(BOX_LINE)
            .stroke();

          doc.rect(
            margin,
            continuationY,
            contentWidth,
            3
          ).fill(YELLOW);

          doc.fillColor(WHITE)
            .font("Helvetica-Bold")
            .fontSize(7)
            .text(
              "DETALLE DEL PRESUPUESTO · CONTINUACIÓN",
              margin + 16,
              continuationY + 12
            );

          y =
            continuationY +
            30;

          drawTableHeader();
        }

        if (index % 2 === 0) {
          doc.rect(
            margin + 1,
            y,
            contentWidth - 2,
            rowH
          ).fill(LIGHT);
        }

        doc.moveTo(
          margin + 1,
          y + rowH
        )
          .lineTo(
            right - 1,
            y + rowH
          )
          .strokeColor(LINE)
          .lineWidth(0.5)
          .stroke();

        const quantity =
          Number(
            item.quantity || 0
          );

        const unitPrice =
          Number(
            item.unit_price || 0
          );

        const total =
          Number(
            item.total ??
            quantity * unitPrice
          );

        doc.fillColor(TEXT)
          .font("Helvetica")
          .fontSize(6.5)
          .text(
            item.description || "-",
            margin + 11,
            y + 9,
            {
              width:
                descWidth - 21,
              ellipsis: true
            }
          );

        doc.fillColor(TEXT)
          .font("Helvetica")
          .fontSize(6.2)
          .text(
            `${quantity} ${
              item.unit || ""
            }`.trim(),
            margin + descWidth,
            y + 9,
            {
              width: qtyWidth,
              align: "center"
            }
          );

        doc.text(
          money(unitPrice),
          margin +
            descWidth +
            qtyWidth,
          y + 9,
          {
            width: priceWidth,
            align: "right"
          }
        );

        doc.fillColor(BLACK)
          .font("Helvetica-Bold")
          .fontSize(6.5)
          .text(
            money(total),
            margin +
              descWidth +
              qtyWidth +
              priceWidth,
            y + 9,
            {
              width:
                totalWidth - 10,
              align: "right"
            }
          );

        y += rowH;
      }
    );
  }

  doc.moveTo(
    margin,
    y
  )
    .lineTo(
      right,
      y
    )
    .strokeColor(BOX_LINE)
    .lineWidth(0.8)
    .stroke();

  // =========================================================
  // 4. TOTALES
  // =========================================================

  const discount =
    Number(
      quote.discount || 0
    );

  const totalsHeight =
    discount > 0
      ? 94
      : 76;

  if (
    y + totalsHeight >
    contentBottom
  ) {
    newPage();
  }

  y += 8;

  const totalsBoxY = y;

  doc.roundedRect(
    margin,
    totalsBoxY,
    contentWidth,
    totalsHeight,
    7
  ).fill(DARK);

  doc.roundedRect(
    margin,
    totalsBoxY,
    contentWidth,
    totalsHeight,
    7
  )
    .lineWidth(0.8)
    .strokeColor(BOX_LINE)
    .stroke();

  doc.rect(
    margin,
    totalsBoxY,
    contentWidth,
    3
  ).fill(ORANGE);

  // SUBTOTAL
  doc.fillColor("#9aa3ae")
    .font("Helvetica-Bold")
    .fontSize(6.2)
    .text(
      "SUBTOTAL",
      margin + 16,
      totalsBoxY + 13
    );

  doc.fillColor(WHITE)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(
      money(quote.subtotal),
      margin + 16,
      totalsBoxY + 12,
      {
        width:
          contentWidth - 32,
        align: "right"
      }
    );

  let totalLineY =
    totalsBoxY + 32;

  // DESCUENTO
  if (discount > 0) {
    doc.fillColor("#9aa3ae")
      .font("Helvetica-Bold")
      .fontSize(6.2)
      .text(
        "DESCUENTO",
        margin + 16,
        totalLineY
      );

    doc.fillColor(ORANGE)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(
        `- ${money(discount)}`,
        margin + 16,
        totalLineY - 1,
        {
          width:
            contentWidth - 32,
          align: "right"
        }
      );

    totalLineY += 20;
  }

  doc.moveTo(
    margin + 16,
    totalLineY
  )
    .lineTo(
      right - 16,
      totalLineY
    )
    .strokeColor("#303742")
    .lineWidth(0.7)
    .stroke();

  doc.fillColor(YELLOW)
    .font("Helvetica-Bold")
    .fontSize(7)
    .text(
      "TOTAL DEL PRESUPUESTO",
      margin + 16,
      totalLineY + 9
    );

  doc.fillColor(YELLOW)
    .font("Helvetica-Bold")
    .fontSize(16)
    .text(
      money(quote.total),
      margin + 16,
      totalLineY + 5,
      {
        width:
          contentWidth - 32,
        align: "right"
      }
    );

  y =
    totalsBoxY +
    totalsHeight +
    7;

  // =========================================================
  // 5. NOTAS Y CONDICIONES
  // =========================================================

  if (quote.notes) {
    const notesText =
      String(
        quote.notes
      ).trim();

    if (notesText) {
      const notesTextWidth =
        contentWidth - 25;

      const availableNoteHeight =
        contentBottom -
        contentTop -
        20;

      const noteChunks =
        splitTextByHeight(
          notesText,
          notesTextWidth,
          Math.max(
            80,
            availableNoteHeight
          ),
          "Helvetica",
          6.8,
          2
        );

      let noteIndex = 0;

      while (
        noteIndex <
        noteChunks.length
      ) {
        const chunk =
          noteChunks[noteIndex];

        const textHeight =
          doc.heightOfString(
            chunk,
            {
              width:
                notesTextWidth,
              font:
                "Helvetica",
              fontSize:
                6.8,
              lineGap:
                2
            }
          );

        const boxHeight =
          Math.max(
            38,
            textHeight + 18
          );

        const requiredHeight =
          12 +
          boxHeight +
          8;

        if (
          y + requiredHeight >
          contentBottom
        ) {
          newPage();
        }

        doc.fillColor(BLACK)
          .font("Helvetica-Bold")
          .fontSize(7.5)
          .text(
            noteIndex === 0
              ? "NOTAS Y CONDICIONES"
              : "NOTAS Y CONDICIONES · CONTINUACIÓN",
            margin,
            y
          );

        doc.fillColor(ORANGE)
          .font("Helvetica-Bold")
          .fontSize(6)
          .text(
            "IMPORTANTE",
            right - 48,
            y + 1,
            {
              width: 48,
              align: "right"
            }
          );

        y += 12;

        doc.roundedRect(
          margin,
          y,
          contentWidth,
          boxHeight,
          6
        ).fill("#fff8df");

        doc.rect(
          margin,
          y,
          4,
          boxHeight
        ).fill(ORANGE);

        doc.fillColor(TEXT)
          .font("Helvetica")
          .fontSize(6.8)
          .text(
            chunk,
            margin + 13,
            y + 9,
            {
              width:
                notesTextWidth,
              lineGap: 2
            }
          );

        y +=
          boxHeight +
          9;

        noteIndex++;
      }
    }
  }

  // =========================================================  // PIE FINAL
  // =========================================================

  drawFooter();

  return doc;
}

// =========================================================
// CONVERTIR PDF A BUFFER
// =========================================================

function pdfToBuffer(doc) {

  return new Promise((resolve, reject) => {

    const chunks = [];


    doc.on("data", chunk => {
      chunks.push(chunk);
    });


    doc.on("end", () => {

      resolve(
        Buffer.concat(chunks)
      );

    });


    doc.on("error", error => {
      reject(error);
    });


    doc.end();

  });

}


// =========================================================
// PDF DE PRESUPUESTO — ADMIN
// =========================================================

app.get(
  "/api/admin/quotes/:id/pdf",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          error: "ID de presupuesto inválido."
        });
      }

      const quote = await getQuoteDetail(pool, id);

      if (!quote) {
        return res.status(404).json({
          error: "Presupuesto no encontrado."
        });
      }

      const doc = buildQuotePdf(quote);
      const pdf = await pdfToBuffer(doc);

      const filename =
        quote.pdf_filename ||
        `presupuesto-${quote.quote_number || id}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${String(filename).replace(/[^a-zA-Z0-9._-]/g, "_")}"`
      );
      res.setHeader("Content-Length", pdf.length);
      res.send(pdf);

    } catch (error) {
      console.error(
        "Error generando PDF del presupuesto:",
        error
      );

      res.status(500).json({
        error: "No se pudo generar el PDF del presupuesto."
      });
    }
  }
);


// =========================================================
// PRESUPUESTOS - ADMIN
// =========================================================


// ---------------------------------------------------------
// LISTAR PRESUPUESTOS
// ---------------------------------------------------------

app.get(
  "/api/admin/quotes",
  requireAdmin,
  async (req, res) => {

    try {

      const [rows] =
        await pool.query(
          `
          SELECT
            q.id,
            q.quote_number,
			q.access_token,
            q.issue_date,
            q.expiration_date,
            q.subtotal,
            q.discount,
            q.total,
            q.status,
            q.created_at,

            qr.id AS quote_request_id,
            qr.name AS client_name,
            qr.email AS client_email,
            qr.phone AS client_phone,
            qr.service AS requested_service,

            COUNT(qi.id) AS items_count

          FROM quotes q

          INNER JOIN quote_requests qr
            ON qr.id = q.quote_request_id

          LEFT JOIN quote_items qi
            ON qi.quote_id = q.id

          GROUP BY
            q.id,
            q.quote_number,
			q.access_token,
            q.issue_date,
            q.expiration_date,
            q.subtotal,
            q.discount,
            q.total,
            q.status,
            q.created_at,
            qr.id,
            qr.name,
            qr.email,
            qr.phone,
            qr.service

          ORDER BY
            q.created_at DESC,
            q.id DESC
          `
        );


      res.json(rows);


    } catch (error) {

      console.error(
        "Error obteniendo presupuestos:",
        error
      );


      res.status(500).json({
        error:
          "No se pudieron obtener los presupuestos."
      });

    }

  }
);


// ---------------------------------------------------------
// OBTENER PRESUPUESTO
// ---------------------------------------------------------

app.get(
  "/api/admin/quotes/:id",
  requireAdmin,
  async (req, res) => {

    try {

      const quoteId = Number(req.params.id);

      if (!Number.isInteger(quoteId) || quoteId <= 0) {
        return res.status(400).json({
          error: "ID de presupuesto inválido."
        });
      }

      const quote =
        await getQuoteDetail(
          pool,
          quoteId
        );


      if (!quote) {

        return res.status(404).json({
          error:
            "Presupuesto no encontrado."
        });

      }


      res.json(quote);


    } catch (error) {

      console.error(
        "Error obteniendo presupuesto:",
        error
      );


      res.status(500).json({
        error:
          "No se pudo obtener el presupuesto."
      });

    }

  }
);
app.get("/api/public/quotes/:token", authLimiter, async (req, res) => {

    try {

      const [rows] = await pool.query(
        `
        SELECT
          q.id,
          q.quote_number,
          q.issue_date,
          q.expiration_date,
          q.notes,
          q.status,
          q.subtotal,
          q.discount,
          q.total,

          qr.name AS client_name,
          qr.email AS client_email,
          qr.phone AS client_phone,
          qr.service AS requested_service,

          qi.id AS item_id,
          qi.description,
          qi.quantity,
          qi.unit,
          qi.unit_price,
          qi.total AS item_total

        FROM quotes q

        INNER JOIN quote_requests qr
          ON qr.id = q.quote_request_id

        LEFT JOIN quote_items qi
          ON qi.quote_id = q.id

        WHERE q.access_token = ?

        ORDER BY qi.id ASC
        `,
        [req.params.token]
      );


      if (!rows.length) {

        return res.status(404).json({
          error:
            "Presupuesto no encontrado o enlace inválido."
        });

      }


      const quote = {
        id: rows[0].id,
        quote_number: rows[0].quote_number,
        issue_date: rows[0].issue_date,
        expiration_date: rows[0].expiration_date,
        notes: rows[0].notes,
        status: rows[0].status,

        subtotal: rows[0].subtotal,
        discount: rows[0].discount,
        total: rows[0].total,

        client_name: rows[0].client_name,
        client_email: rows[0].client_email,
        client_phone: rows[0].client_phone,
        requested_service: rows[0].requested_service,

        items: []
      };


      for (const row of rows) {

        if (row.item_id) {

          quote.items.push({
            id: row.item_id,
            description: row.description,
            quantity: row.quantity,
            unit: row.unit,
            unit_price: row.unit_price,
            total: row.item_total
          });

        }

      }


      res.json(quote);


    } catch (error) {

      console.error(
        "Error obteniendo presupuesto público:",
        error
      );


      res.status(500).json({
        error:
          "No se pudo obtener el presupuesto."
      });

    }

  }
);
// ========================================
// PRESUPUESTOS - ADMIN
// ========================================

// =====================================================
// NOTIFICACIONES DEL ADMINISTRADOR
// =====================================================

app.get(
  "/api/admin/notifications",
  requireAdmin,
  async (req, res) => {

    try {

      const [rows] = await pool.query(
        `
        SELECT
          id,
          type,
          quote_id,
          message,
          is_read,
          created_at
        FROM admin_notifications
        ORDER BY
          is_read ASC,
          created_at DESC
        LIMIT 50
        `
      );

      const [countRows] = await pool.query(
        `
        SELECT COUNT(*) AS unread
        FROM admin_notifications
        WHERE is_read = 0
        `
      );

      res.json({
        success: true,
        notifications: rows,
        unread: Number(countRows[0].unread || 0)
      });

    } catch (error) {

      console.error(
        "Error obteniendo notificaciones:",
        error
      );

      res.status(500).json({
        error:
          "No se pudieron obtener las notificaciones."
      });

    }

  }
);


// =====================================================
// MARCAR UNA NOTIFICACIÓN COMO LEÍDA
// =====================================================

app.post(
  "/api/admin/notifications/:id/read",
  requireAdmin,
  async (req, res) => {

    try {

      const notificationId = Number(req.params.id);

      if (
        !Number.isInteger(notificationId) ||
        notificationId <= 0
      ) {

        return res.status(400).json({
          error: "ID de notificación inválido."
        });

      }

      const [result] = await pool.query(
        `
        UPDATE admin_notifications
        SET is_read = 1
        WHERE id = ?
        `,
        [notificationId]
      );

      if (result.affectedRows === 0) {

        return res.status(404).json({
          error: "Notificación no encontrada."
        });

      }

      res.json({
        success: true,
        message:
          "Notificación marcada como leída."
      });

    } catch (error) {

      console.error(
        "Error marcando notificación como leída:",
        error
      );

      res.status(500).json({
        error:
          "No se pudo actualizar la notificación."
      });

    }

  }
);


// =====================================================
// MARCAR TODAS LAS NOTIFICACIONES COMO LEÍDAS
// =====================================================

app.post(
  "/api/admin/notifications/read-all",
  requireAdmin,
  async (req, res) => {

    try {

      await pool.query(
        `
        UPDATE admin_notifications
        SET is_read = 1
        WHERE is_read = 0
        `
      );

      res.json({
        success: true,
        message:
          "Todas las notificaciones fueron marcadas como leídas."
      });

    } catch (error) {

      console.error(
        "Error marcando todas las notificaciones como leídas:",
        error
      );

      res.status(500).json({
        error:
          "No se pudieron marcar las notificaciones como leídas."
      });

    }

  }
);



// ---------------------------------------------------------
// ACEPTAR PRESUPUESTO PÚBLICO
// ---------------------------------------------------------

app.post("/api/public/quotes/:token/accept", authLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `
      UPDATE quotes
      SET status = 'aceptado'
      WHERE access_token = ?
        AND status = 'enviado'
        AND (
          expiration_date IS NULL
          OR expiration_date >= CURDATE()
        )
      `,
      [req.params.token]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();

      const [rows] = await connection.query(
        `
        SELECT status
        FROM quotes
        WHERE access_token = ?
        `,
        [req.params.token]
      );

      if (!rows.length) {
        return res.status(404).json({
          error: "Presupuesto no encontrado."
        });
      }

      if (rows[0].status === "aceptado") {
        return res.json({
          success: true,
          status: "aceptado",
          message: "El presupuesto ya fue aceptado."
        });
      }

      return res.status(400).json({
        error: "Este presupuesto ya no puede modificarse."
      });
    }

    const [quoteRows] = await connection.query(
      `
      SELECT
        q.id,
        q.quote_number,
        qr.name AS client_name
      FROM quotes q
      INNER JOIN quote_requests qr
        ON qr.id = q.quote_request_id
      WHERE q.access_token = ?
      LIMIT 1
      `,
      [req.params.token]
    );

    if (!quoteRows.length) {
      await connection.rollback();
      return res.status(404).json({
        error: "Presupuesto no encontrado."
      });
    }

    const quote = quoteRows[0];

    await connection.query(
      `
      INSERT INTO jobs
      (
        quote_id,
        status
      )
      VALUES (?, 'aceptado')
      ON DUPLICATE KEY UPDATE
        status = 'aceptado'
      `,
      [quote.id]
    );

    await connection.query(
      `
      INSERT INTO admin_notifications
      (
        type,
        quote_id,
        message
      )
      VALUES (?, ?, ?)
      `,
      [
        "quote_accepted",
        quote.id,
        `El cliente ${quote.client_name} aceptó el presupuesto ${quote.quote_number}.`
      ]
    );

    await connection.commit();

    res.json({
      success: true,
      status: "aceptado",
      message: "Presupuesto aceptado correctamente."
    });

  } catch (error) {
    await connection.rollback().catch(() => {});

    console.error(
      "Error aceptando presupuesto:",
      error
    );

    res.status(500).json({
      error:
        "No se pudo aceptar el presupuesto."
    });
  } finally {
    connection.release();
  }
});

// ---------------------------------------------------------
// RECHAZAR PRESUPUESTO PÚBLICO
// ---------------------------------------------------------

app.post("/api/public/quotes/:token/reject", authLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `
      UPDATE quotes
      SET status = 'rechazado'
      WHERE access_token = ?
        AND status = 'enviado'
        AND (
          expiration_date IS NULL
          OR expiration_date >= CURDATE()
        )
      `,
      [req.params.token]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();

      const [rows] = await connection.query(
        `
        SELECT status
        FROM quotes
        WHERE access_token = ?
        `,
        [req.params.token]
      );

      if (!rows.length) {
        return res.status(404).json({
          error: "Presupuesto no encontrado."
        });
      }

      if (rows[0].status === "rechazado") {
        return res.json({
          success: true,
          status: "rechazado",
          message: "El presupuesto ya fue rechazado."
        });
      }

      return res.status(400).json({
        error: "Este presupuesto ya no puede modificarse."
      });
    }

    const [quoteRows] = await connection.query(
      `
      SELECT
        q.id,
        q.quote_number,
        qr.name AS client_name
      FROM quotes q
      INNER JOIN quote_requests qr
        ON qr.id = q.quote_request_id
      WHERE q.access_token = ?
      LIMIT 1
      `,
      [req.params.token]
    );

    if (!quoteRows.length) {
      await connection.rollback();
      return res.status(404).json({
        error: "Presupuesto no encontrado."
      });
    }

    const quote = quoteRows[0];

    await connection.query(
      `
      INSERT INTO jobs
      (
        quote_id,
        status
      )
      VALUES (?, 'rechazado')
      ON DUPLICATE KEY UPDATE
        status = 'rechazado'
      `,
      [quote.id]
    );

    await connection.query(
      `
      INSERT INTO admin_notifications
      (
        type,
        quote_id,
        message
      )
      VALUES (?, ?, ?)
      `,
      [
        "quote_rejected",
        quote.id,
        `El cliente ${quote.client_name} rechazó el presupuesto ${quote.quote_number}.`
      ]
    );

    await connection.commit();

    res.json({
      success: true,
      status: "rechazado",
      message: "Presupuesto rechazado correctamente."
    });

  } catch (error) {
    await connection.rollback().catch(() => {});

    console.error(
      "Error rechazando presupuesto:",
      error
    );

    res.status(500).json({
      error:
        "No se pudo rechazar el presupuesto."
    });
  } finally {
    connection.release();
  }
});


// =========================================================
// PRODUCCIÓN - HEALTH CHECK
// =========================================================

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({
      ok: true,
      service: "jr-electricidad"
    });
  } catch (error) {
    logError("Health check MySQL", { error: error.message });
    res.status(503).json({
      ok: false,
      service: "jr-electricidad"
    });
  }
});


// =========================================================
// PRODUCCIÓN - 404
// =========================================================

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "Ruta no encontrada."
    });
  }

  return res.status(404).sendFile(
    path.join(__dirname, "public", "index.html")
  );
});


// =========================================================
// MANEJO GLOBAL DE ERRORES
// Debe quedar al final de todas las rutas.
// =========================================================

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "La imagen no puede superar los 5 MB."
      });
    }

    return res.status(400).json({
      error: "Error al subir la imagen."
    });
  }

  logError("Error no controlado", { requestId: req.requestId, error: err.message, stack: err.stack });

  return res.status(500).json({
    error: "Error interno del servidor."
  });
});

start();