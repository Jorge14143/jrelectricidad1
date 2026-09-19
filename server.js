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
const { configureEmailService, queueEmail } = require("./lib/email");
const { configureWhatsAppService, queueWhatsApp, buildWhatsAppLink, providerConfigured: whatsappProviderConfigured } = require("./lib/whatsapp");
const { createDocumentStorage, DOCUMENT_TYPES, ALLOWED_DOCUMENT_MIMES, MAX_DOCUMENT_SIZE, normalizeDocumentType, safeDocumentName, documentFileName, sha256File, validateDocumentSignature } = require("./lib/documents");
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



// =========================================================
// V2 — ALMACENAMIENTO PRIVADO DE DOCUMENTOS
// =========================================================

const documentsDir = createDocumentStorage(path.join(__dirname, "storage", "documents"));

const documentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, documentsDir),
    filename: (req, file, cb) => cb(null, documentFileName(file.originalname))
  }),
  limits: { fileSize: MAX_DOCUMENT_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_DOCUMENT_MIMES.has(file.mimetype)) {
      return cb(new Error("Tipo de documento no permitido."));
    }
    cb(null, true);
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

configureEmailService(pool);
configureWhatsAppService(pool);


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
    await pool.query("DELETE FROM active_sessions WHERE user_id=? AND session_id<>?", [userId, keepSessionId]).catch(() => {});
    return;
  }
  await pool.query(`DELETE FROM sessions WHERE data LIKE ?`, [pattern]);
  await pool.query("DELETE FROM active_sessions WHERE user_id=?", [userId]).catch(() => {});
}

async function isLoginLocked(email, ip) {
  const [userRows] = await pool.query(
    "SELECT locked_until FROM users WHERE email=? LIMIT 1",
    [email]
  );
  if (userRows[0]?.locked_until && new Date(userRows[0].locked_until).getTime() > Date.now()) {
    return true;
  }

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

    if (userId) {
      if (success) {
        await pool.query(
          "UPDATE users SET failed_login_count=0, locked_until=NULL WHERE id=?",
          [userId]
        );
      } else {
        const [rows] = await pool.query(
          `SELECT COUNT(*) AS failures
           FROM login_attempts
           WHERE user_id=? AND success=0
             AND created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)`,
          [userId]
        );
        if (Number(rows[0]?.failures || 0) >= 5) {
          await pool.query(
            "UPDATE users SET failed_login_count=failed_login_count+1, locked_until=DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE id=?",
            [userId]
          );
        } else {
          await pool.query(
            "UPDATE users SET failed_login_count=failed_login_count+1 WHERE id=?",
            [userId]
          );
        }
      }
    }
  } catch (error) {
    logError("No se pudo registrar intento de login", { requestId: req.requestId, error: error.message });
  }
}

function cleanUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    email_verified: Boolean(user.email_verified ?? user.email_verified_at),
    email_verified_at: user.email_verified_at || null,
    pending_email: user.pending_email || null,
    avatar_url: user.avatar_url || null,
    totp_enabled: Boolean(user.totp_enabled)
  };
}


// =========================================================
// EMAIL DE RECUPERACIÓN
// =========================================================

async function sendResetEmail(email, token) {
  const link = process.env.APP_URL + "/reset-password.html?token=" + encodeURIComponent(token);
  await queueEmail({
    to: email,
    subject: "Recuperación de contraseña - JR Electricidad",
    template: "password_reset",
    data: { link, minutes: 30 }
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


      const passwordError = validatePassword(newPassword);
      if (passwordError) {
        return res.status(400).json({ error: passwordError });
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
      await writeAudit(req, "password_changed", "user", req.session.user.id);
      await createAdminNotification({
        type: "security",
        message: "Tu contraseña fue actualizada correctamente.",
        userId: req.session.user.id,
        entityType: "user",
        entityId: req.session.user.id,
        linkUrl: "/cuenta.html",
        priority: "high"
      }).catch(() => {});

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

// =========================================================
// CUENTA DEL USUARIO - CAMBIO DE EMAIL SEGURO
// =========================================================

const ACCOUNT_TOKEN_MINUTES = 30;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 190;
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

async function sendAccountMail({ to, subject, title, text, linkLabel, link }) {
  return queueEmail({
    to,
    subject,
    template: "generic_account",
    data: { title, text, linkLabel, link, minutes: ACCOUNT_TOKEN_MINUTES }
  });
}

async function createAccountEmailToken(userId, email, purpose) {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = tokenHash(token);
  await pool.query(
    `DELETE FROM account_email_tokens WHERE user_id=? AND purpose=?`,
    [userId, purpose]
  );
  await pool.query(
    `INSERT INTO account_email_tokens
      (user_id, email, purpose, token_hash, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [userId, email, purpose, hash, ACCOUNT_TOKEN_MINUTES]
  );
  return token;
}

async function getValidAccountEmailToken(token, purpose) {
  const hash = tokenHash(token);
  const [rows] = await pool.query(
    `SELECT id, user_id, email, purpose, expires_at
     FROM account_email_tokens
     WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at > NOW()
     LIMIT 1`,
    [hash, purpose]
  );
  return rows[0] || null;
}

async function sendEmailVerification(userId, email) {
  const token = await createAccountEmailToken(userId, email, "verify");
  const link = `${process.env.APP_URL}/api/account/email/verify?token=${encodeURIComponent(token)}`;
  await sendAccountMail({
    to: email,
    subject: "Confirmá tu correo - JR Electricidad",
    title: "Confirmación de correo electrónico",
    text: "Confirmá tu dirección de correo para completar la configuración de tu cuenta.",
    linkLabel: "Confirmar correo",
    link
  });
}

async function sendEmailChangeConfirmation(userId, newEmail) {
  const token = await createAccountEmailToken(userId, newEmail, "change");
  const link = `${process.env.APP_URL}/api/account/email/confirm-change?token=${encodeURIComponent(token)}`;
  await sendAccountMail({
    to: newEmail,
    subject: "Confirmá el cambio de correo - JR Electricidad",
    title: "Confirmación de cambio de correo",
    text: "Recibimos una solicitud para cambiar el correo de tu cuenta. Confirmá la nueva dirección para aplicar el cambio.",
    linkLabel: "Confirmar nuevo correo",
    link
  });
  return token;
}

// Solicita una verificación inicial o reenvío.
app.post(
  "/api/account/email/verify/request",
  requireAuth,
  authLimiter,
  async (req, res) => {
    try {
      const userId = Number(req.session.user.id);
      const [rows] = await pool.query(
        "SELECT id, email, email_verified_at FROM users WHERE id=? LIMIT 1",
        [userId]
      );
      if (!rows.length) return res.status(404).json({ error: "Usuario no encontrado." });
      if (rows[0].email_verified_at) {
        return res.json({ success: true, verified: true, message: "El correo ya está confirmado." });
      }

      try {
        await sendEmailVerification(userId, rows[0].email);
      } catch (mailError) {
        logError("No se pudo enviar verificación de correo", {
          requestId: req.requestId,
          userId,
          error: mailError.message
        });
        return res.status(503).json({ error: "No se pudo enviar el correo de confirmación." });
      }

      await writeAudit(req, "email_verification_requested", "user", userId);
      res.json({ success: true, verified: false, message: "Te enviamos un correo de confirmación." });
    } catch (error) {
      logError("Error solicitando verificación de correo", { requestId: req.requestId, error: error.message });
      res.status(500).json({ error: "No se pudo solicitar la verificación." });
    }
  }
);

app.get("/api/account/email/verify", async (req, res) => {
  try {
    const token = String(req.query.token || "");
    if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).send("Enlace de verificación inválido o vencido.");

    const record = await getValidAccountEmailToken(token, "verify");
    if (!record) return res.status(400).send("Enlace de verificación inválido, vencido o ya utilizado.");

    await pool.query("UPDATE users SET email_verified_at=NOW() WHERE id=? AND email=?", [record.user_id, record.email]);
    await pool.query("UPDATE account_email_tokens SET used_at=NOW() WHERE id=?", [record.id]);

    await pool.query(
      "DELETE FROM account_email_tokens WHERE user_id=? AND purpose='verify' AND id<>?",
      [record.user_id, record.id]
    );

    res.send(`
      <!doctype html><html lang="es"><head><meta charset="utf-8"><title>Correo confirmado</title></head>
      <body style="font-family:Arial,sans-serif;padding:40px;text-align:center;background:#080a0f;color:#f5f7fb">
        <h1>✅ Correo confirmado</h1>
        <p>Tu dirección de correo fue confirmada correctamente.</p>
        <p><a href="/" style="color:#ffc400">Volver a JR Electricidad</a></p>
      </body></html>
    `);
  } catch (error) {
    logError("Error verificando correo", { requestId: req.requestId, error: error.message });
    res.status(500).send("No se pudo confirmar el correo.");
  }
});

// Solicita el cambio: el email actual no se modifica hasta confirmar el nuevo.
app.put(
  "/api/account/email",
  requireAuth,
  authLimiter,
  async (req, res) => {
    try {
      const userId = Number(req.session.user.id);
      const newEmail = normalizeEmail(req.body.newEmail);
      const currentPassword = String(req.body.currentPassword || "");

      if (!validEmail(newEmail)) return res.status(400).json({ error: "Ingresá un email válido." });
      if (!currentPassword) return res.status(400).json({ error: "Ingresá tu contraseña actual." });
      if (newEmail === normalizeEmail(req.session.user.email)) {
        return res.status(400).json({ error: "El nuevo correo es igual al actual." });
      }

      const [rows] = await pool.query(
        "SELECT id, email, password_hash FROM users WHERE id=? LIMIT 1",
        [userId]
      );
      if (!rows.length) return res.status(404).json({ error: "Usuario no encontrado." });

      const validPassword = await bcrypt.compare(currentPassword, rows[0].password_hash);
      if (!validPassword) return res.status(401).json({ error: "La contraseña actual es incorrecta." });

      const [existing] = await pool.query(
        "SELECT id FROM users WHERE email=? AND id<>? LIMIT 1",
        [newEmail, userId]
      );
      if (existing.length) return res.status(409).json({ error: "Ese email ya está registrado." });

      await pool.query(
        `DELETE FROM account_email_tokens
         WHERE user_id=? AND purpose='change'`,
        [userId]
      );

      await pool.query(
        "UPDATE users SET pending_email=? WHERE id=?",
        [newEmail, userId]
      );

      try {
        await sendEmailChangeConfirmation(userId, newEmail);
      } catch (mailError) {
        await pool.query(
          "UPDATE users SET pending_email=NULL WHERE id=? AND pending_email=?",
          [userId, newEmail]
        );
        await pool.query(
          "DELETE FROM account_email_tokens WHERE user_id=? AND purpose='change'",
          [userId]
        );
        logError("No se pudo enviar confirmación de cambio de email", {
          requestId: req.requestId,
          userId,
          error: mailError.message
        });
        return res.status(503).json({ error: "No se pudo enviar el correo de confirmación." });
      }

      // El aviso al correo actual es complementario: si falla, no invalida
      // una solicitud que ya fue enviada correctamente al nuevo correo.
      try {
        await sendAccountMail({
          to: rows[0].email,
          subject: "Solicitud de cambio de correo - JR Electricidad",
          title: "Se solicitó un cambio de correo",
          text: `Se solicitó cambiar el correo de tu cuenta a ${newEmail}. El cambio solo se aplicará después de confirmar la nueva dirección. Si no fuiste vos, iniciá sesión y cambiá tu contraseña.`
        });
      } catch (mailError) {
        logError("No se pudo enviar aviso al correo actual", {
          requestId: req.requestId,
          userId,
          error: mailError.message
        });
      }

      await writeAudit(req, "email_change_requested", "user", userId, { pendingEmail: true });
      res.json({
        success: true,
        pending: true,
        email: rows[0].email,
        pending_email: newEmail,
        message: "Te enviamos un correo al nuevo email. El cambio se aplicará cuando lo confirmes."
      });
    } catch (error) {
      logError("Error solicitando cambio de email", { requestId: req.requestId, error: error.message });
      res.status(500).json({ error: "No se pudo solicitar el cambio de correo." });
    }
  }
);

app.get("/api/account/email/confirm-change", async (req, res) => {
  try {
    const token = String(req.query.token || "");
    if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).send("Enlace de cambio inválido o vencido.");

    const record = await getValidAccountEmailToken(token, "change");
    if (!record) return res.status(400).send("Enlace de cambio inválido, vencido o ya utilizado.");

    const [users] = await pool.query(
      "SELECT id, email, pending_email FROM users WHERE id=? LIMIT 1",
      [record.user_id]
    );
    if (!users.length || users[0].pending_email !== record.email) {
      return res.status(409).send("El cambio de correo ya no es válido.");
    }

    const [conflict] = await pool.query(
      "SELECT id FROM users WHERE email=? AND id<>? LIMIT 1",
      [record.email, record.user_id]
    );
    if (conflict.length) {
      await pool.query("DELETE FROM account_email_tokens WHERE id=?", [record.id]);
      await pool.query("UPDATE users SET pending_email=NULL WHERE id=?", [record.user_id]);
      return res.status(409).send("Ese correo ya fue registrado por otra cuenta.");
    }

    await pool.query(
      "UPDATE users SET email=?, pending_email=NULL, email_verified_at=NOW() WHERE id=?",
      [record.email, record.user_id]
    );
    await pool.query("UPDATE account_email_tokens SET used_at=NOW() WHERE id=?", [record.id]);

    // El cambio de correo invalida todas las sesiones por seguridad.
    await invalidateUserSessions(record.user_id);
    await writeAudit(req, "email_changed", "user", record.user_id, { emailChanged: true });

    res.send(`
      <!doctype html><html lang="es"><head><meta charset="utf-8"><title>Correo actualizado</title></head>
      <body style="font-family:Arial,sans-serif;padding:40px;text-align:center;background:#080a0f;color:#f5f7fb">
        <h1>✅ Correo actualizado</h1>
        <p>Tu correo fue actualizado y por seguridad cerramos tus sesiones.</p>
        <p>Ahora podés volver a iniciar sesión.</p>
        <p><a href="/login.html" style="color:#ffc400">Iniciar sesión</a></p>
      </body></html>
    `);
  } catch (error) {
    logError("Error confirmando cambio de email", { requestId: req.requestId, error: error.message });
    res.status(500).send("No se pudo completar el cambio de correo.");
  }
});

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

      if (!name || name.length > 100) {
        return res.status(400).json({ error: "El nombre es obligatorio y no puede superar 100 caracteres." });
      }

      await pool.query("UPDATE users SET name=? WHERE id=?", [name, userId]);
      req.session.user.name = name;

      await writeAudit(req, "profile_updated", "user", userId, { fields: ["name"] });

      const [rows] = await pool.query(
        "SELECT id, name, email, role, email_verified_at, pending_email, avatar_url, totp_enabled FROM users WHERE id=? LIMIT 1",
        [userId]
      );

      res.json({
        success: true,
        message: "Datos personales actualizados correctamente.",
        user: cleanUser(rows[0])
      });
    } catch (error) {
      logError("Error actualizando perfil", { requestId: req.requestId, error: error.message });
      res.status(500).json({ error: "No se pudieron actualizar los datos personales." });
    }
  }
);

// =========================================================
// AVATAR OPCIONAL
// =========================================================

app.put(
  "/api/account/avatar",
  requireAuth,
  authLimiter,
  async (req, res) => {
    try {
      const avatarUrl = String(req.body.avatar_url || "").trim();
      if (avatarUrl && (avatarUrl.length > 500 || !/^https:\/\//i.test(avatarUrl))) {
        return res.status(400).json({ error: "El avatar debe ser una URL HTTPS válida." });
      }

      const userId = Number(req.session.user.id);
      await pool.query("UPDATE users SET avatar_url=? WHERE id=?", [avatarUrl || null, userId]);
      await writeAudit(req, "avatar_updated", "user", userId, { hasAvatar: Boolean(avatarUrl) });

      const [rows] = await pool.query(
        "SELECT id, name, email, role, email_verified_at, avatar_url, totp_enabled FROM users WHERE id=? LIMIT 1",
        [userId]
      );
      res.json({ success: true, message: avatarUrl ? "Avatar actualizado." : "Avatar eliminado.", user: cleanUser(rows[0]) });
    } catch (error) {
      logError("Error actualizando avatar", { requestId: req.requestId, error: error.message });
      res.status(500).json({ error: "No se pudo actualizar el avatar." });
    }
  }
);

// =========================================================
// HISTORIAL PERSONAL DE ACTIVIDAD
// =========================================================

app.get(
  "/api/account/activity",
  requireAuth,
  async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
      const [rows] = await pool.query(
        `SELECT id, action, entity_type, entity_id, created_at, request_id, metadata
         FROM audit_log
         WHERE actor_user_id=?
         ORDER BY created_at DESC
         LIMIT ${limit}`,
        [Number(req.session.user.id)]
      );

      const activity = rows.map(row => ({
        id: row.id,
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        created_at: row.created_at,
        request_id: row.request_id,
        metadata: (() => {
          try { return row.metadata ? JSON.parse(row.metadata) : null; } catch { return null; }
        })()
      }));

      res.json({ success: true, activity });
    } catch (error) {
      logError("Error obteniendo actividad personal", { requestId: req.requestId, error: error.message });
      res.status(500).json({ error: "No se pudo obtener el historial de actividad." });
    }
  }
);

app.get(
  "/api/account/email/status",
  requireAuth,
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT email, email_verified_at, pending_email FROM users WHERE id=? LIMIT 1",
        [Number(req.session.user.id)]
      );
      if (!rows.length) return res.status(404).json({ error: "Usuario no encontrado." });
      res.json({
        success: true,
        email: rows[0].email,
        verified: Boolean(rows[0].email_verified_at),
        email_verified_at: rows[0].email_verified_at || null,
        pending_email: rows[0].pending_email || null
      });
    } catch (error) {
      logError("Error obteniendo estado del email", { requestId: req.requestId, error: error.message });
      res.status(500).json({ error: "No se pudo obtener el estado del correo." });
    }
  }
);


// =========================================================
// AUDITORÍA ADMIN — FASE 17
// =========================================================

app.get("/api/admin/audit", requireAdmin, async (req, res) => {
  try {
    const page = Math.min(Math.max(Number(req.query.page) || 1, 1), 100000);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = (page - 1) * limit;
    const action = String(req.query.action || "").trim().slice(0, 100);
    const entityType = String(req.query.entity_type || "").trim().slice(0, 100);
    const actor = String(req.query.actor || "").trim().slice(0, 190);
    const q = String(req.query.q || "").trim().replace(/\s+/g, " ").slice(0, 100);
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    const where = [];
    const params = [];

    if (action) { where.push("a.action=?"); params.push(action); }
    if (entityType) { where.push("a.entity_type=?"); params.push(entityType); }
    if (actor) {
      where.push("(u.name LIKE ? OR u.email LIKE ?)");
      params.push("%" + actor + "%", "%" + actor + "%");
    }
    if (q) {
      where.push("(a.action LIKE ? OR a.entity_type LIKE ? OR a.entity_id LIKE ? OR a.request_id LIKE ? OR a.ip_address LIKE ? OR a.user_agent LIKE ? OR CAST(a.metadata AS CHAR) LIKE ?)");
      const t = "%" + q + "%";
      params.push(t, t, t, t, t, t, t);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) { where.push("a.created_at >= ?"); params.push(dateFrom + " 00:00:00"); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) { where.push("a.created_at < DATE_ADD(?, INTERVAL 1 DAY)"); params.push(dateTo); }

    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM audit_log a
       LEFT JOIN users u ON u.id=a.actor_user_id
       ${whereSql}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT a.id, a.actor_user_id, u.name AS actor_name, u.email AS actor_email,
              a.action, a.entity_type, a.entity_id, a.ip_address,
              a.user_agent, a.request_id, a.metadata, a.created_at
       FROM audit_log a
       LEFT JOIN users u ON u.id=a.actor_user_id
       ${whereSql}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const actions = await pool.query(
      "SELECT DISTINCT action FROM audit_log ORDER BY action ASC LIMIT 500"
    );
    const entityTypes = await pool.query(
      "SELECT DISTINCT entity_type FROM audit_log WHERE entity_type IS NOT NULL AND entity_type<>'' ORDER BY entity_type ASC LIMIT 200"
    );

    res.json({
      success: true,
      page,
      limit,
      total: Number(countRow.total || 0),
      total_pages: Math.ceil(Number(countRow.total || 0) / limit),
      filters: {
        actions: actions[0].map(row => row.action),
        entity_types: entityTypes[0].map(row => row.entity_type)
      },
      audit: rows.map(row => ({
        ...row,
        metadata: (() => {
          try { return row.metadata ? JSON.parse(row.metadata) : null; } catch { return null; }
        })()
      }))
    });
  } catch (error) {
    logError("Error obteniendo auditoría administrativa", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo obtener la auditoría." });
  }
});

app.get("/api/admin/audit/export", requireAdmin, async (req, res) => {
  try {
    const action = String(req.query.action || "").trim().slice(0, 100);
    const entityType = String(req.query.entity_type || "").trim().slice(0, 100);
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();
    const where = [];
    const params = [];
    if (action) { where.push("a.action=?"); params.push(action); }
    if (entityType) { where.push("a.entity_type=?"); params.push(entityType); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) { where.push("a.created_at >= ?"); params.push(dateFrom + " 00:00:00"); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) { where.push("a.created_at < DATE_ADD(?, INTERVAL 1 DAY)"); params.push(dateTo); }

    const [rows] = await pool.query(
      `SELECT a.id, a.created_at, u.name AS actor_name, u.email AS actor_email,
              a.action, a.entity_type, a.entity_id, a.ip_address, a.request_id,
              a.user_agent, a.metadata
       FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 10000`,
      params
    );

    const csvCell = value => {
      const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
      return '"' + String(text).replace(/"/g, '""').replace(/[\r\n]+/g, " ") + '"';
    };
    const header = ["id","created_at","actor_name","actor_email","action","entity_type","entity_id","ip_address","request_id","user_agent","metadata"];
    const lines = [header.join(",")];
    for (const row of rows) {
      lines.push(header.map(key => csvCell(row[key])).join(","));
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="jr-electricidad-auditoria.csv"');
    res.send("\uFEFF" + lines.join("\n"));
  } catch (error) {
    logError("Error exportando auditoría", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo exportar la auditoría." });
  }
});

// =========================================================
// BÚSQUEDA GLOBAL ADMIN — FASE 15
// =========================================================

app.get("/api/admin/search", requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().replace(/\s+/g, " ");
    if (q.length < 2) return res.json({ query: q, results: [] });

    const term = "%" + q.slice(0, 100) + "%";
    const sql = `
      SELECT * FROM (
        SELECT u.id,'user' AS result_type,u.name AS title,u.email AS subtitle,'Usuarios' AS section,'#usersSection' AS link
        FROM users u WHERE u.name LIKE ? OR u.email LIKE ?
        UNION ALL
        SELECT c.id,'client',c.name,CONCAT_WS(' · ',c.phone,c.email),'Clientes','#clientsSection'
        FROM clients c WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.address LIKE ? OR c.locality LIKE ?
        UNION ALL
        SELECT qr.id,'request',CONCAT('Solicitud #',qr.id,' · ',qr.name),CONCAT_WS(' · ',qr.service,qr.phone,qr.email,qr.status),'Solicitudes','#quoteRequestsSection'
        FROM quote_requests qr WHERE qr.name LIKE ? OR qr.phone LIKE ? OR qr.email LIKE ? OR qr.service LIKE ? OR qr.description LIKE ?
        UNION ALL
        SELECT q.id,'quote',CONCAT('Presupuesto ',q.quote_number),CONCAT_WS(' · ',qr.name,qr.phone,q.status),'Presupuestos','#quotesSection'
        FROM quotes q INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
        WHERE q.quote_number LIKE ? OR qr.name LIKE ? OR qr.phone LIKE ? OR q.status LIKE ? OR q.notes LIKE ?
        UNION ALL
        SELECT j.id,'job',CONCAT('Trabajo #',j.id),CONCAT_WS(' · ',qr.name,j.status,j.location),'Trabajos','#jobsSection'
        FROM jobs j INNER JOIN quotes q ON q.id=j.quote_id INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
        WHERE CAST(j.id AS CHAR) LIKE ? OR qr.name LIKE ? OR j.status LIKE ? OR j.location LIKE ? OR j.internal_notes LIKE ? OR j.execution_notes LIKE ? OR j.completion_notes LIKE ?
        UNION ALL
        SELECT s.id,'service',s.title,CONCAT_WS(' · ',s.description,s.category),'Servicios','#servicesSection'
        FROM services s WHERE s.title LIKE ? OR s.description LIKE ? OR s.category LIKE ?
        UNION ALL
        SELECT g.id,'gallery',g.title,CONCAT_WS(' · ',g.description,g.category,g.alt_text),'Galería','#gallerySection'
        FROM gallery g WHERE g.title LIKE ? OR g.description LIKE ? OR g.category LIKE ? OR g.alt_text LIKE ?
        UNION ALL
        SELECT d.id,'document',d.title,CONCAT_WS(' · ',d.document_type,d.description),'Documentos','#documentsSection'
        FROM documents d WHERE d.title LIKE ? OR d.description LIKE ? OR d.document_type LIKE ?
      ) results
      ORDER BY title ASC
      LIMIT 50
    `;
    const params = Array(33).fill(term);
    const [rows] = await pool.query(sql, params);
    res.json({ query:q, count:rows.length, results:rows });
  } catch (error) {
    logError("Error en búsqueda global", {requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo realizar la búsqueda global."});
  }
});

// =========================================================
// CONFIGURACIÓN DEL NEGOCIO
// =========================================================

async function ensureNotificationSchema() {
  // La estructura V2 se instala mediante la migración 010.
  await pool.query("ALTER TABLE admin_notifications MODIFY quote_id INT NULL").catch(error => {
    if (!/Duplicate|already exists/i.test(error.message)) throw error;
  });

  await pool.query(
    "ALTER TABLE admin_notifications ADD INDEX idx_notifications_read_created (is_read, created_at)"
  ).catch(error => {
    if (!/Duplicate key name|already exists/i.test(error.message)) throw error;
  });
}

async function createAdminNotification({
  type,
  message,
  userId = null,
  quoteId = null,
  entityType = null,
  entityId = null,
  linkUrl = null,
  priority = "normal"
}) {
  const allowedTypes = new Set([
    "quote_accepted","quote_rejected","quote_request_created","quote_request_status",
    "quote_sent","job_assigned","job_scheduled","job_started","job_status_changed",
    "job_finished","job_closed","gallery_published","security","system"
  ]);
  const allowedPriorities = new Set(["low","normal","high","urgent"]);
  if (!allowedTypes.has(type)) throw new Error("Tipo de notificación inválido.");
  if (!allowedPriorities.has(priority)) priority = "normal";

  const [result] = await pool.query(
    "INSERT INTO admin_notifications (user_id,type,quote_id,entity_type,entity_id,message,link_url,priority,is_read,read_at,archived_at) VALUES (?,?,?,?,?,?,?,?,0,NULL,NULL)",
    [
      userId == null ? null : Number(userId),
      type,
      quoteId == null ? null : Number(quoteId),
      entityType,
      entityId == null ? null : Number(entityId),
      String(message || "").slice(0, 500),
      linkUrl ? String(linkUrl).slice(0, 500) : null,
      priority
    ]
  );
  return result.insertId;
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
      whatsapp_enabled TINYINT(1) NOT NULL DEFAULT 0,
      whatsapp_auto_notifications TINYINT(1) NOT NULL DEFAULT 0,
      currency_code VARCHAR(10) NOT NULL DEFAULT 'ARS',
      currency_symbol VARCHAR(10) NOT NULL DEFAULT '

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
        whatsapp_enabled: Boolean(req.body.whatsapp_enabled),
        whatsapp_auto_notifications: Boolean(req.body.whatsapp_auto_notifications),
        email: String(req.body.email || "").trim().toLowerCase(),
        address: String(req.body.address || "").trim(),
        city: String(req.body.city || "").trim(),
        hours: String(req.body.hours || "").trim(),
        logo_url: String(req.body.logo_url || "").trim(),
        pdf_footer: String(req.body.pdf_footer || "").trim(),
        pdf_notes: String(req.body.pdf_notes || "").trim(),
        currency_code: String(req.body.currency_code || "ARS").trim().toUpperCase(),
        currency_symbol: String(req.body.currency_symbol || "$").trim(),
        tax_enabled: Boolean(req.body.tax_enabled),
        tax_name: String(req.body.tax_name || "IVA").trim(),
        tax_rate: Number(req.body.tax_rate || 0),
        quote_prefix: String(req.body.quote_prefix || "PR-").trim(),
        quote_next_number: Number(req.body.quote_next_number || 1),
        job_prefix: String(req.body.job_prefix || "TR-").trim(),
        job_next_number: Number(req.body.job_next_number || 1),
        quote_validity_days: Number(req.body.quote_validity_days || 15),
        quote_default_notes: String(req.body.quote_default_notes || "").trim(),
        quote_terms: String(req.body.quote_terms || "").trim(),
        commercial_conditions: String(req.body.commercial_conditions || "").trim()
      };

      if (!fields.business_name) return res.status(400).json({ error: "El nombre comercial es obligatorio." });
      if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
        return res.status(400).json({ error: "Ingresá un email válido." });
      }
      if (!/^[A-Z0-9._-]{2,10}$/.test(fields.currency_code)) {
        return res.status(400).json({ error: "El código de moneda debe tener entre 2 y 10 caracteres." });
      }
      if (!Number.isFinite(fields.tax_rate) || fields.tax_rate < 0 || fields.tax_rate > 100) {
        return res.status(400).json({ error: "El impuesto debe estar entre 0 y 100%." });
      }
      if (!Number.isInteger(fields.quote_next_number) || fields.quote_next_number < 1 || fields.quote_next_number > 4294967295) {
        return res.status(400).json({ error: "La numeración inicial de presupuestos no es válida." });
      }
      if (!Number.isInteger(fields.job_next_number) || fields.job_next_number < 1 || fields.job_next_number > 4294967295) {
        return res.status(400).json({ error: "La numeración inicial de trabajos no es válida." });
      }
      if (!Number.isInteger(fields.quote_validity_days) || fields.quote_validity_days < 0 || fields.quote_validity_days > 3650) {
        return res.status(400).json({ error: "La vigencia del presupuesto debe estar entre 0 y 3650 días." });
      }

      const limits = {
        business_name: 150, legal_name: 180, phone: 50, whatsapp: 50, email: 190,
        address: 255, city: 120, hours: 255, logo_url: 500, pdf_footer: 500,
        pdf_notes: 5000, currency_symbol: 10, tax_name: 80, quote_prefix: 20,
        job_prefix: 20, quote_default_notes: 10000, quote_terms: 10000,
        commercial_conditions: 10000
      };
      for (const [key, max] of Object.entries(limits)) {
        if (fields[key].length > max) return res.status(400).json({ error: `El campo ${key} supera el máximo permitido.` });
      }

      await pool.query(
        `UPDATE business_settings
         SET business_name=?, legal_name=?, phone=?, whatsapp=?,
             whatsapp_enabled=?, whatsapp_auto_notifications=?,
             email=?, address=?, city=?, hours=?, logo_url=?,
             pdf_footer=?, pdf_notes=?, currency_code=?, currency_symbol=?,
             tax_enabled=?, tax_name=?, tax_rate=?, quote_prefix=?,
             quote_next_number=?, job_prefix=?, job_next_number=?,
             quote_validity_days=?, quote_default_notes=?, quote_terms=?,
             commercial_conditions=?
         WHERE id=1`,
        [
          fields.business_name, fields.legal_name, fields.phone, fields.whatsapp,
          fields.whatsapp_enabled ? 1 : 0, fields.whatsapp_auto_notifications ? 1 : 0,
          fields.email, fields.address, fields.city, fields.hours, fields.logo_url,
          fields.pdf_footer, fields.pdf_notes, fields.currency_code, fields.currency_symbol,
          fields.tax_enabled ? 1 : 0, fields.tax_name, fields.tax_rate, fields.quote_prefix,
          fields.quote_next_number, fields.job_prefix, fields.job_next_number,
          fields.quote_validity_days, fields.quote_default_notes, fields.quote_terms,
          fields.commercial_conditions
        ]
      );

      await writeAudit(req, "business_settings_updated", "business_settings", 1, {
        currency_code: fields.currency_code,
        tax_enabled: fields.tax_enabled,
        tax_rate: fields.tax_rate
      });

      res.json({ success: true, message: "Configuración guardada correctamente." });
    } catch (error) {
      logError("Error guardando configuración", { requestId: req.requestId, error: error.message });
      res.status(500).json({ error: "No se pudo guardar la configuración." });
    }
  }
);


app.get(
  "/api/settings",
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT business_name, legal_name, phone, whatsapp, email, address, city, hours, logo_url,
                currency_code, currency_symbol, tax_enabled, tax_name, tax_rate,
                quote_prefix, quote_next_number, job_prefix, job_next_number,
                quote_validity_days, quote_default_notes, quote_terms, commercial_conditions
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
  async (req, res) => {
    if (!req.session.user) return res.json({ user: null });

    try {
      const [rows] = await pool.query(
        `SELECT id, name, email, role, email_verified_at, pending_email, avatar_url, totp_enabled
         FROM users WHERE id=? LIMIT 1`,
        [Number(req.session.user.id)]
      );
      if (!rows.length) return res.json({ user: null });

      req.session.user = {
        ...req.session.user,
        id: rows[0].id,
        name: rows[0].name,
        email: rows[0].email,
        role: rows[0].role
      };

      res.json({ user: cleanUser(rows[0]) });
    } catch (error) {
      logError("Error obteniendo usuario actual", { requestId: req.requestId, error: error.message });
      res.status(500).json({ error: "No se pudo obtener la cuenta." });
    }
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

      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({ error: passwordError });
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
      await registerActiveSession(req, result.insertId);
      await writeAudit(req, "register", "user", result.insertId);
      try {
        await sendEmailVerification(result.insertId, normalized);
      } catch (mailError) {
        logError("No se pudo enviar verificación tras registro", {
          requestId: req.requestId,
          userId: result.insertId,
          error: mailError.message
        });
      }

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
            created_at,
            email_verified_at,
            avatar_url,
            totp_enabled
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
    const userId = req.session?.user?.id || null;
    const sessionId = req.sessionID;

    req.session.destroy(
      () => {
        removeActiveSession(sessionId);
        if (userId) {
          writeAudit(req, "logout", "user", userId);
        }

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
        password.length < PASSWORD_MIN ||
        password.length > PASSWORD_MAX
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

    // V2: vincular automáticamente la solicitud con un cliente existente.
    let clientId = null;
    const clientQuery = await pool.query("SELECT id FROM clients WHERE phone=? LIMIT 1", [cleanPhone]);
    const clientRows = clientQuery[0];
    if (clientRows.length) {
      clientId = clientRows[0].id;
      await pool.query(
        `UPDATE clients SET name=?, email=COALESCE(NULLIF(?, ''), email) WHERE id=?`,
        [cleanName, cleanEmail || "", clientId]
      );
    } else {
      const clientQueryResult = await pool.query(
        `INSERT INTO clients (name, phone, email) VALUES (?, ?, ?)`,
        [cleanName, cleanPhone, cleanEmail || null]
      );
      clientId = clientQueryResult[0].insertId;
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
        image_url,
        client_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        cleanName,
        cleanPhone,
        cleanEmail,
        cleanService,
        cleanDescription,
        preferred_date || null,
        imageUrl,
        clientId
      ]
    );

    // La solicitud ya fue guardada correctamente. La notificación
    // nunca debe hacer fallar el envío de la solicitud.
    try {
      await createAdminNotification({
        type: "quote_request_created",
        message: `Nueva solicitud de presupuesto de ${cleanName}.`,
        entityType: "quote_request",
        entityId: result.insertId,
        linkUrl: "/admin.html#quoteRequestsSection",
        priority: "high"
      });
    } catch (notificationError) {
      logError("Solicitud guardada, pero no se pudo crear la notificación", {
        requestId: req.requestId,
        error: notificationError.message
      });
    }

    const [createdRequestRows] = await pool.query(
      "SELECT id,name,email,phone,whatsapp,service,status FROM quote_requests WHERE id=? LIMIT 1",
      [result.insertId]
    );
    if (createdRequestRows.length) {
      await notifyRequestCustomer(
        createdRequestRows[0],
        "Solicitud recibida - JR Electricidad",
        "Recibimos correctamente tu solicitud de presupuesto."
      );
      await notifyRequestWhatsApp(
        createdRequestRows[0],
        `JR Electricidad: recibimos tu solicitud #${createdRequestRows[0].id}. Te contactaremos luego de revisarla.`
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
// GALERÍA V2 — PÚBLICA + ADMIN
// =========================================================

const GALLERY_CATEGORIES = [
  "instalaciones",
  "reparaciones",
  "tableros",
  "iluminacion",
  "mantenimiento",
  "otros"
];

function parseOptionalId(value) {
  if (value === "" || value === null || value === undefined) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateGalleryCategory(value) {
  const category = String(value || "otros").trim().toLowerCase();
  return GALLERY_CATEGORIES.includes(category) ? category : null;
}

function galleryCategoryLabel(category) {
  return ({
    instalaciones: "Instalaciones",
    reparaciones: "Reparaciones",
    tableros: "Tableros eléctricos",
    iluminacion: "Iluminación",
    mantenimiento: "Mantenimiento",
    otros: "Otros"
  })[category] || "Otros";
}

async function validateGalleryRelations({ clientId, jobId, quoteId }) {
  if (clientId !== null) {
    const [rows] = await pool.query("SELECT id FROM clients WHERE id=? LIMIT 1", [clientId]);
    if (!rows.length) return "El cliente vinculado no existe.";
  }
  if (quoteId !== null) {
    const [rows] = await pool.query("SELECT id, quote_request_id FROM quotes WHERE id=? LIMIT 1", [quoteId]);
    if (!rows.length) return "El presupuesto vinculado no existe.";
  }
  if (jobId !== null) {
    const [rows] = await pool.query(
      "SELECT j.id, j.status, j.quote_id FROM jobs j WHERE j.id=? LIMIT 1",
      [jobId]
    );
    if (!rows.length) return "El trabajo vinculado no existe.";
    if (!["finalizado", "cerrado"].includes(rows[0].status)) {
      return "Solo se pueden publicar trabajos de la galería vinculados a trabajos finalizados o cerrados.";
    }
  }
  if (jobId !== null && quoteId !== null) {
    const [rows] = await pool.query("SELECT id FROM jobs WHERE id=? AND quote_id=? LIMIT 1", [jobId, quoteId]);
    if (!rows.length) return "El trabajo y el presupuesto vinculados no corresponden entre sí.";
  }
  if (jobId !== null && clientId !== null) {
    const [rows] = await pool.query(
      "SELECT j.id FROM jobs j INNER JOIN quotes q ON q.id=j.quote_id INNER JOIN quote_requests qr ON qr.id=q.quote_request_id WHERE j.id=? AND qr.client_id=? LIMIT 1",
      [jobId, clientId]
    );
    if (!rows.length) return "El trabajo y el cliente vinculados no corresponden entre sí.";
  }
  return null;
}

async function deleteGalleryFile(imageUrl) {
  if (!imageUrl || !String(imageUrl).startsWith("/uploads/")) return;
  const imageFile = path.join(__dirname, "public", String(imageUrl).replace(/^\/+/, ""));
  if (fs.existsSync(imageFile)) await fs.promises.unlink(imageFile).catch(() => {});
}

app.get("/api/gallery", async (req, res) => {
  try {
    const category = String(req.query.category || "").trim().toLowerCase();
    const params = [];
    let sql = "SELECT id,title,description,image_url,alt_text,category,featured,sort_order,client_id,job_id,quote_id,created_at FROM gallery WHERE active=1";
    if (category && GALLERY_CATEGORIES.includes(category)) {
      sql += " AND category=?";
      params.push(category);
    }
    sql += " ORDER BY featured DESC,sort_order ASC,created_at DESC";
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo galería pública", {requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron cargar los trabajos."});
  }
});

app.get("/api/admin/gallery", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const category = String(req.query.category || "").trim().toLowerCase();
    const status = String(req.query.status || "").trim().toLowerCase();
    const params = [];
    let sql = "SELECT g.id,g.title,g.description,g.image_url,g.alt_text,g.active,g.featured,g.sort_order,g.category,g.client_id,g.job_id,g.quote_id,g.created_at,g.updated_at,c.name AS client_name,j.status AS job_status,q.quote_number FROM gallery g LEFT JOIN clients c ON c.id=g.client_id LEFT JOIN jobs j ON j.id=g.job_id LEFT JOIN quotes q ON q.id=g.quote_id WHERE 1=1";
    if (search) {
      const v = "%" + search + "%";
      sql += " AND (g.title LIKE ? OR g.description LIKE ? OR g.alt_text LIKE ? OR g.category LIKE ? OR c.name LIKE ? OR q.quote_number LIKE ?)";
      params.push(v,v,v,v,v,v);
    }
    if (category && GALLERY_CATEGORIES.includes(category)) {
      sql += " AND g.category=?";
      params.push(category);
    }
    if (status === "active") sql += " AND g.active=1";
    if (status === "inactive") sql += " AND g.active=0";
    if (status === "featured") sql += " AND g.featured=1";
    sql += " ORDER BY g.sort_order ASC,g.created_at DESC";
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo galería admin", {requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron cargar los trabajos."});
  }
});

app.get("/api/admin/gallery/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query(
      "SELECT g.*,c.name AS client_name,j.status AS job_status,q.quote_number FROM gallery g LEFT JOIN clients c ON c.id=g.client_id LEFT JOIN jobs j ON j.id=g.job_id LEFT JOIN quotes q ON q.id=g.quote_id WHERE g.id=? LIMIT 1",
      [id]
    );
    if (!rows.length) return res.status(404).json({error:"Trabajo de galería no encontrado."});
    res.json(rows[0]);
  } catch (error) {
    logError("Error obteniendo detalle de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el trabajo de galería."});
  }
});

app.post("/api/admin/gallery", requireAdmin, adminMutationLimiter, upload.single("image"), validateUploadedImage, async (req, res) => {
  try {
    const title=String(req.body.title||"").trim();
    const description=String(req.body.description||"").trim();
    const altText=String(req.body.alt_text||req.body.altText||title).trim();
    const category=validateGalleryCategory(req.body.category);
    const active=["true","1"].includes(String(req.body.active))?1:0;
    const featured=["true","1"].includes(String(req.body.featured))?1:0;
    const clientId=parseOptionalId(req.body.client_id);
    const jobId=parseOptionalId(req.body.job_id);
    const quoteId=parseOptionalId(req.body.quote_id);

    if(!title||title.length>150){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El título es obligatorio y no puede superar 150 caracteres."});}
    if(description.length>500){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"La descripción no puede superar 500 caracteres."});}
    if(!altText||altText.length>255){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El texto alternativo es obligatorio y no puede superar 255 caracteres."});}
    if(!category){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"La categoría seleccionada no es válida."});}
    const relationError=await validateGalleryRelations({clientId,jobId,quoteId});
    if(relationError){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:relationError});}
    if(!req.file)return res.status(400).json({error:"Debes seleccionar una imagen."});

    const imageUrl="/uploads/"+req.file.filename;
    const [[orderRow]]=await pool.query("SELECT COALESCE(MAX(sort_order),0)+1 AS next_order FROM gallery");
    const sortOrder=Number(orderRow.next_order||1);
    const [result]=await pool.query(
      "INSERT INTO gallery (title,description,image_url,alt_text,category,active,featured,sort_order,client_id,job_id,quote_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [title,description,imageUrl,altText,category,active,featured,sortOrder,clientId,jobId,quoteId]
    );
    await writeAudit(req,"gallery_created","gallery",result.insertId,{category,featured,jobId,quoteId,clientId});
    if (active) {
      await createAdminNotification({
        type: "gallery_published",
        message: `La galería publicó "${title}".`,
        entityType: "gallery",
        entityId: result.insertId,
        quoteId,
        linkUrl: "/admin.html#gallerySection",
        priority: featured ? "high" : "normal"
      }).catch(() => {});
    }
    res.status(201).json({ok:true,message:"Trabajo agregado correctamente.",id:result.insertId,image_url:imageUrl});
  } catch(error) {
    if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});
    logError("Error agregando trabajo de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo agregar el trabajo."});
  }
});

app.put("/api/admin/gallery/:id(\\d+)", requireAdmin, adminMutationLimiter, upload.single("image"), validateUploadedImage, async (req, res) => {
  try {
    const id=Number(req.params.id);
    const [[existing]]=await pool.query("SELECT * FROM gallery WHERE id=? LIMIT 1",[id]);
    if(!existing){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(404).json({error:"Trabajo no encontrado."});}

    const title=String(req.body.title||"").trim();
    const description=String(req.body.description||"").trim();
    const altText=String(req.body.alt_text||req.body.altText||title).trim();
    const category=validateGalleryCategory(req.body.category);
    const active=["true","1"].includes(String(req.body.active))?1:0;
    const featured=["true","1"].includes(String(req.body.featured))?1:0;
    const clientId=parseOptionalId(req.body.client_id);
    const jobId=parseOptionalId(req.body.job_id);
    const quoteId=parseOptionalId(req.body.quote_id);

    if(!title||title.length>150){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El título es obligatorio y no puede superar 150 caracteres."});}
    if(description.length>500){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"La descripción no puede superar 500 caracteres."});}
    if(!altText||altText.length>255){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El texto alternativo es obligatorio y no puede superar 255 caracteres."});}
    if(!category){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"La categoría seleccionada no es válida."});}

    const relationError=await validateGalleryRelations({clientId,jobId,quoteId});
    if(relationError){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:relationError});}

    let imageUrl=existing.image_url;
    if(req.file)imageUrl="/uploads/"+req.file.filename;

    await pool.query(
      "UPDATE gallery SET title=?,description=?,image_url=?,alt_text=?,category=?,active=?,featured=?,client_id=?,job_id=?,quote_id=? WHERE id=?",
      [title,description,imageUrl,altText,category,active,featured,clientId,jobId,quoteId,id]
    );
    if(req.file&&existing.image_url!==imageUrl&&!existing.source_job_attachment_id)await deleteGalleryFile(existing.image_url);
    await writeAudit(req,"gallery_updated","gallery",id,{category,featured,jobId,quoteId,clientId});
    if (!Number(existing.active) && active) {
      await createAdminNotification({
        type: "gallery_published",
        message: `La galería publicó "${title}".`,
        entityType: "gallery",
        entityId: id,
        quoteId,
        linkUrl: "/admin.html#gallerySection",
        priority: featured ? "high" : "normal"
      }).catch(() => {});
    }
    res.json({ok:true,message:"Trabajo actualizado correctamente."});
  }catch(error){
    if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});
    logError("Error editando trabajo de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el trabajo."});
  }
});

app.delete("/api/admin/gallery/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req,res)=>{
  try{
    const id=Number(req.params.id);
    const [[existing]]=await pool.query("SELECT image_url,source_job_attachment_id FROM gallery WHERE id=? LIMIT 1",[id]);
    if(!existing)return res.status(404).json({error:"Trabajo no encontrado."});
    await pool.query("DELETE FROM gallery WHERE id=?",[id]);
    if(!existing.source_job_attachment_id)await deleteGalleryFile(existing.image_url);
    await writeAudit(req,"gallery_deleted","gallery",id);
    res.json({ok:true,message:"Trabajo eliminado correctamente."});
  }catch(error){
    logError("Error eliminando trabajo de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo eliminar el trabajo."});
  }
});

app.put("/api/admin/gallery/:id(\\d+)/order", requireAdmin, adminMutationLimiter, async (req,res)=>{
  try{
    const id=Number(req.params.id);
    const direction=String(req.body.direction||"");
    if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:"ID inválido."});
    if(!["up","down"].includes(direction))return res.status(400).json({error:"Dirección inválida."});
    const [[current]]=await pool.query("SELECT id,sort_order FROM gallery WHERE id=? LIMIT 1",[id]);
    if(!current)return res.status(404).json({error:"Trabajo no encontrado."});
    const comparison=direction==="up"?"<":">";
    const orderDirection=direction==="up"?"DESC":"ASC";
    const [[neighbor]]=await pool.query(
      "SELECT id,sort_order FROM gallery WHERE sort_order "+comparison+" ? ORDER BY sort_order "+orderDirection+", id "+orderDirection+" LIMIT 1",
      [current.sort_order]
    );
    if(!neighbor)return res.json({ok:true,message:direction==="up"?"Ya está primero.":"Ya está último."});
    await pool.query("UPDATE gallery SET sort_order=? WHERE id=?",[neighbor.sort_order,current.id]);
    await pool.query("UPDATE gallery SET sort_order=? WHERE id=?",[current.sort_order,neighbor.id]);
    await writeAudit(req,"gallery_reordered","gallery",id,{direction});
    res.json({ok:true,message:"Orden actualizado correctamente."});
  }catch(error){
    logError("Error cambiando orden de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo cambiar el orden."});
  }
});

app.post("/api/admin/gallery/from-job-attachment/:attachmentId(\\d+)", requireAdmin, adminMutationLimiter, async (req,res)=>{
  try{
    const attachmentId=Number(req.params.attachmentId);
    const [[attachment]]=await pool.query(
      "SELECT ja.*,j.status AS job_status,j.quote_id,qr.client_id,qr.service,qr.description,q.quote_number FROM job_attachments ja INNER JOIN jobs j ON j.id=ja.job_id INNER JOIN quotes q ON q.id=j.quote_id INNER JOIN quote_requests qr ON qr.id=q.quote_request_id WHERE ja.id=? LIMIT 1",
      [attachmentId]
    );
    if(!attachment)return res.status(404).json({error:"La evidencia no existe."});
    if(!["image/jpeg","image/png","image/webp","image/gif"].includes(attachment.mime_type))return res.status(400).json({error:"Solo se pueden publicar imágenes como trabajos de galería."});
    if(!["finalizado","cerrado"].includes(attachment.job_status))return res.status(400).json({error:"Solo se pueden publicar evidencias de trabajos finalizados o cerrados."});

    const title=String(req.body.title||attachment.service||"Trabajo realizado").trim();
    const description=String(req.body.description||attachment.description||"").trim();
    const altText=String(req.body.alt_text||title).trim();
    const category=validateGalleryCategory(req.body.category||"otros");
    const active=["true","1"].includes(String(req.body.active??"1"))?1:0;
    const featured=["true","1"].includes(String(req.body.featured))?1:0;
    if(!title||title.length>150)return res.status(400).json({error:"El título es obligatorio y no puede superar 150 caracteres."});
    if(description.length>500)return res.status(400).json({error:"La descripción no puede superar 500 caracteres."});
    if(!altText||altText.length>255)return res.status(400).json({error:"El texto alternativo no es válido."});
    if(!category)return res.status(400).json({error:"La categoría no es válida."});

    const [[duplicate]]=await pool.query("SELECT id FROM gallery WHERE job_id=? AND image_url=? LIMIT 1",[attachment.job_id,attachment.url]);
    if(duplicate)return res.status(409).json({error:"Esta evidencia ya está publicada en la galería.",id:duplicate.id});

    const [[orderRow]]=await pool.query("SELECT COALESCE(MAX(sort_order),0)+1 AS next_order FROM gallery");
    const [result]=await pool.query(
      "INSERT INTO gallery (title,description,image_url,alt_text,category,active,featured,sort_order,client_id,job_id,quote_id,source_job_attachment_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [title,description,attachment.url,altText,category,active,featured,Number(orderRow.next_order||1),attachment.client_id||null,attachment.job_id,attachment.quote_id,attachmentId]
    );
    await writeAudit(req,"gallery_promoted_from_job_attachment","gallery",result.insertId,{attachmentId,jobId:attachment.job_id});
    if (active) {
      await createAdminNotification({
        type: "gallery_published",
        message: `La evidencia del trabajo #${attachment.job_id} fue publicada en la galería.`,
        entityType: "gallery",
        entityId: result.insertId,
        quoteId: attachment.quote_id,
        linkUrl: "/admin.html#gallerySection",
        priority: featured ? "high" : "normal"
      }).catch(() => {});
    }
    res.status(201).json({ok:true,id:result.insertId,message:"La evidencia fue publicada en la galería."});
  }catch(error){
    logError("Error promocionando evidencia a galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo publicar la evidencia en la galería."});
  }
});

app.get("/api/admin/gallery/categories", requireAdmin, (req,res)=>{
  res.json(GALLERY_CATEGORIES.map(value=>({value,label:galleryCategoryLabel(value)})));
});

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
// ADMIN - CLIENTES V2
// =========================================================

function cleanClientInput(body) {
  return {
    name: String(body.name || "").trim(),
    phone: String(body.phone || "").trim(),
    whatsapp: String(body.whatsapp || "").trim(),
    email: normalizeEmail(body.email),
    address: String(body.address || "").trim(),
    locality: String(body.locality || "").trim(),
    notes: String(body.notes || "").trim()
  };
}

function validateClientInput(client) {
  if (!client.name || client.name.length > 150) return "El nombre es obligatorio y no puede superar 150 caracteres.";
  if (!client.phone || client.phone.length > 50) return "El teléfono es obligatorio y no puede superar 50 caracteres.";
  if (client.whatsapp.length > 50) return "El WhatsApp no puede superar 50 caracteres.";
  if (client.email && !validEmail(client.email)) return "El email del cliente no es válido.";
  if (client.address.length > 255) return "La dirección no puede superar 255 caracteres.";
  if (client.locality.length > 120) return "La localidad no puede superar 120 caracteres.";
  if (client.notes.length > 5000) return "Las notas no pueden superar 5000 caracteres.";
  return null;
}

app.get("/api/admin/clients", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const locality = String(req.query.locality || "").trim();
    const params = [];
    let sql = `
      SELECT
        c.id, c.user_id, c.name, c.phone, c.whatsapp, c.email,
        c.address, c.locality, c.notes, c.created_at, c.updated_at,
        COUNT(DISTINCT qr.id) AS requests,
        COUNT(DISTINCT q.id) AS quotes,
        COUNT(DISTINCT j.id) AS jobs,
        MAX(COALESCE(j.updated_at, q.updated_at, qr.created_at, c.updated_at)) AS last_activity
      FROM clients c
      LEFT JOIN quote_requests qr ON qr.client_id=c.id
      LEFT JOIN quotes q ON q.quote_request_id=qr.id
      LEFT JOIN jobs j ON j.quote_id=q.id
      WHERE 1=1
    `;

    if (search) {
      sql += ` AND (c.name LIKE ? OR c.phone LIKE ? OR c.whatsapp LIKE ? OR c.email LIKE ? OR c.address LIKE ? OR c.locality LIKE ?) `;
      const v = `%${search}%`;
      params.push(v,v,v,v,v,v);
    }
    if (locality) {
      sql += " AND c.locality LIKE ?";
      params.push(`%${locality}%`);
    }

    sql += `
      GROUP BY c.id
      ORDER BY last_activity DESC, c.name ASC
    `;

    const [rows] = await pool.query(sql, params);
    res.json({
      success: true,
      clients: rows.map(c => ({
        ...c,
        requests: Number(c.requests || 0),
        quotes: Number(c.quotes || 0),
        jobs: Number(c.jobs || 0)
      }))
    });
  } catch (error) {
    logError("Error obteniendo clientes", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener los clientes." });
  }
});

app.post("/api/admin/clients", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const client = cleanClientInput(req.body);
    const validationError = validateClientInput(client);
    if (validationError) return res.status(400).json({ error: validationError });

    const [existing] = await pool.query("SELECT id FROM clients WHERE phone=? LIMIT 1", [client.phone]);
    if (existing.length) return res.status(409).json({ error: "Ya existe un cliente con ese teléfono." });

    const [result] = await pool.query(
      `INSERT INTO clients (name,phone,whatsapp,email,address,locality,notes)
       VALUES (?,?,?,?,?,?,?)`,
      [client.name,client.phone,client.whatsapp||null,client.email||null,client.address||null,client.locality||null,client.notes||null]
    );
    await writeAudit(req, "client_created", "client", result.insertId);
    res.status(201).json({ success:true, client:{ id:result.insertId, ...client } });
  } catch (error) {
    logError("Error creando cliente", { requestId:req.requestId, error:error.message });
    res.status(500).json({ error:"No se pudo crear el cliente." });
  }
});

app.get("/api/admin/clients/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id=Number(req.params.id);
    if (!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de cliente inválido."});
    const [rows]=await pool.query("SELECT * FROM clients WHERE id=? LIMIT 1",[id]);
    if (!rows.length) return res.status(404).json({error:"Cliente no encontrado."});
    res.json({success:true,client:rows[0]});
  } catch(error) {
    logError("Error obteniendo cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el cliente."});
  }
});

app.put("/api/admin/clients/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const id=Number(req.params.id);
    if (!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de cliente inválido."});
    const client=cleanClientInput(req.body);
    const validationError=validateClientInput(client);
    if (validationError) return res.status(400).json({error:validationError});

    const [existing]=await pool.query("SELECT id FROM clients WHERE phone=? AND id<>? LIMIT 1",[client.phone,id]);
    if(existing.length) return res.status(409).json({error:"Ya existe otro cliente con ese teléfono."});

    const [result]=await pool.query(
      `UPDATE clients SET name=?,phone=?,whatsapp=?,email=?,address=?,locality=?,notes=? WHERE id=?`,
      [client.name,client.phone,client.whatsapp||null,client.email||null,client.address||null,client.locality||null,client.notes||null,id]
    );
    if(!result.affectedRows) return res.status(404).json({error:"Cliente no encontrado."});
    await writeAudit(req,"client_updated","client",id);
    const [rows]=await pool.query("SELECT * FROM clients WHERE id=? LIMIT 1",[id]);
    res.json({success:true,message:"Cliente actualizado correctamente.",client:rows[0]});
  } catch(error) {
    logError("Error actualizando cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el cliente."});
  }
});

app.delete("/api/admin/clients/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de cliente inválido."});
    const [result]=await pool.query("DELETE FROM clients WHERE id=?",[id]);
    if(!result.affectedRows) return res.status(404).json({error:"Cliente no encontrado."});
    await writeAudit(req,"client_deleted","client",id);
    res.json({success:true,message:"Cliente eliminado correctamente."});
  } catch(error) {
    logError("Error eliminando cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo eliminar el cliente."});
  }
});

app.get("/api/admin/clients/:id(\\d+)/history", requireAdmin, async (req, res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de cliente inválido."});

    const [clientRows]=await pool.query("SELECT * FROM clients WHERE id=? LIMIT 1",[id]);
    if(!clientRows.length) return res.status(404).json({error:"Cliente no encontrado."});

    const [requests]=await pool.query(
      `SELECT id,name,phone,email,service,description,preferred_date,image_url,status,created_at
       FROM quote_requests WHERE client_id=? ORDER BY created_at DESC`,[id]
    );
    const [quotes]=await pool.query(
      `SELECT q.id,q.quote_number,q.issue_date,q.expiration_date,q.status,q.subtotal,q.discount,q.total,
              q.created_at,q.updated_at,j.id AS job_id,j.status AS job_status,j.started_at,j.completed_at
       FROM quotes q
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       LEFT JOIN jobs j ON j.quote_id=q.id
       WHERE qr.client_id=? ORDER BY q.created_at DESC`,[id]
    );
    const [jobs]=await pool.query(
      `SELECT j.id,j.quote_id,j.status,j.started_at,j.completed_at,j.created_at,j.updated_at,
              q.quote_number, q.total,
              qr.service,qr.description
       FROM jobs j
       INNER JOIN quotes q ON q.id=j.quote_id
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE qr.client_id=? ORDER BY j.created_at DESC`,[id]
    );

    res.json({
      success:true,
      client:clientRows[0],
      requests,quotes,jobs,
      summary:{
        requests:requests.length,
        quotes:quotes.length,
        jobs:jobs.length,
        completedJobs:jobs.filter(j=>j.status==="cerrado").length,
        totalQuoted:quotes.reduce((sum,q)=>sum+Number(q.total||0),0)
      }
    });
  } catch(error) {
    logError("Error obteniendo historial del cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el historial del cliente."});
  }
});

// Compatibilidad V1: ficha por teléfono/email.
app.get("/api/admin/clients/detail", requireAdmin, async (req,res)=>{
  try {
    const phone=String(req.query.phone||"").trim();
    const email=normalizeEmail(req.query.email);
    if(!phone) return res.status(400).json({error:"El teléfono del cliente es obligatorio."});
    const [rows]=await pool.query("SELECT id FROM clients WHERE phone=? LIMIT 1",[phone]);
    if(!rows.length) return res.status(404).json({error:"No se encontró el cliente."});
    const id=rows[0].id;
    const [clientRows]=await pool.query("SELECT * FROM clients WHERE id=? LIMIT 1",[id]);
    const [requests]=await pool.query("SELECT id,name,phone,email,service,description,preferred_date,image_url,status,created_at FROM quote_requests WHERE client_id=? ORDER BY created_at DESC",[id]);
    const [quotes]=await pool.query(
      `SELECT q.id,q.quote_number,q.issue_date,q.expiration_date,q.status,q.subtotal,q.discount,q.total,q.created_at,q.updated_at,
              j.id AS job_id,j.status AS job_status,j.started_at,j.completed_at
       FROM quotes q INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       LEFT JOIN jobs j ON j.quote_id=q.id WHERE qr.client_id=? ORDER BY q.created_at DESC`,[id]
    );
    res.json({success:true,client:clientRows[0],requests,quotes});
  } catch(error) {
    logError("Error obteniendo ficha compatible del cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener la ficha del cliente."});
  }
});

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

      const [[clientsSummary]] = await pool.query(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN 1 ELSE 0 END) AS newClients
         FROM clients`,
        [days]
      );

      const [[gallerySummary]] = await pool.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) AS published,
                SUM(CASE WHEN featured=1 AND active=1 THEN 1 ELSE 0 END) AS featured
         FROM gallery`
      );

      const [[requestPipeline]] = await pool.query(
        `SELECT
          SUM(CASE WHEN status='pendiente' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status='en_revision' THEN 1 ELSE 0 END) AS review,
          SUM(CASE WHEN status='presupuestando' THEN 1 ELSE 0 END) AS quoting,
          SUM(CASE WHEN status='presupuestada' THEN 1 ELSE 0 END) AS quoted,
          SUM(CASE WHEN status='aceptada' THEN 1 ELSE 0 END) AS accepted
         FROM quote_requests`
      );

      const [upcomingJobs] = await pool.query(
        `SELECT j.id,j.status,j.scheduled_at,j.location,
                COALESCE(c.name,qr.name,'Sin cliente') AS client_name,
                u.name AS technician_name
         FROM jobs j
         LEFT JOIN clients c ON c.id=j.client_id
         LEFT JOIN quote_requests qr ON qr.id=j.quote_request_id
         LEFT JOIN users u ON u.id=j.assigned_user_id
         WHERE j.scheduled_at IS NOT NULL
           AND j.scheduled_at >= NOW()
           AND j.status IN ('aceptado','programado','en_proceso','pausado')
         ORDER BY j.scheduled_at ASC
         LIMIT 8`
      );

      const [topServices] = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(qr.service),''),'Sin servicio') AS service,
                COUNT(*) AS requests,
                SUM(CASE WHEN qr.status='aceptada' THEN 1 ELSE 0 END) AS accepted
         FROM quote_requests qr
         GROUP BY COALESCE(NULLIF(TRIM(qr.service),''),'Sin servicio')
         ORDER BY requests DESC, accepted DESC
         LIMIT 6`
      );

      const [jobStatusSummary] = await pool.query(
        `SELECT status,COUNT(*) AS total
         FROM jobs
         GROUP BY status
         ORDER BY total DESC`
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
        recentActivity,
        clients: {
          total: Number(clientsSummary.total || 0),
          newClients: Number(clientsSummary.newClients || 0)
        },
        gallery: {
          total: Number(gallerySummary.total || 0),
          published: Number(gallerySummary.published || 0),
          featured: Number(gallerySummary.featured || 0)
        },
        requestPipeline: {
          pending: Number(requestPipeline.pending || 0),
          review: Number(requestPipeline.review || 0),
          quoting: Number(requestPipeline.quoting || 0),
          quoted: Number(requestPipeline.quoted || 0),
          accepted: Number(requestPipeline.accepted || 0)
        },
        upcomingJobs: upcomingJobs.map(row => ({
          id: Number(row.id),
          status: row.status,
          scheduledAt: row.scheduled_at,
          location: row.location,
          clientName: row.client_name,
          technicianName: row.technician_name
        })),
        topServices: topServices.map(row => ({
          service: row.service,
          requests: Number(row.requests || 0),
          accepted: Number(row.accepted || 0)
        })),
        jobStatusSummary: jobStatusSummary.map(row => ({
          status: row.status,
          total: Number(row.total || 0)
        }))
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
// V2 — SESIONES ACTIVAS
// =========================================================

app.get("/api/account/sessions", requireAuth, async (req, res) => {
  try {
    await registerActiveSession(req, req.session.user.id);
    const [rows] = await pool.query(
      `SELECT id, ip_address, user_agent, created_at, last_seen_at,
              session_id = ? AS current_session
       FROM active_sessions
       WHERE user_id=?
       ORDER BY last_seen_at DESC`,
      [req.sessionID, req.session.user.id]
    );

    res.json({
      success: true,
      sessions: rows.map(row => ({
        id: row.id,
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        created_at: row.created_at,
        last_seen_at: row.last_seen_at,
        current: Boolean(row.current_session)
      }))
    });
  } catch (error) {
    logError("Error listando sesiones", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudieron obtener las sesiones." });
  }
});

app.delete("/api/account/sessions/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: "Sesión inválida." });

    const [rows] = await pool.query(
      "SELECT session_id, user_id FROM active_sessions WHERE id=? AND user_id=? LIMIT 1",
      [id, req.session.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: "Sesión no encontrada." });
    if (rows[0].session_id === req.sessionID) {
      return res.status(400).json({ success: false, error: "No podés cerrar la sesión actual desde este listado." });
    }

    await pool.query("DELETE FROM sessions WHERE session_id=?", [rows[0].session_id]);
    await pool.query("DELETE FROM active_sessions WHERE id=?", [id]);
    await writeAudit(req, "session_revoked", "session", id);
    res.json({ success: true, message: "Sesión cerrada correctamente." });
  } catch (error) {
    logError("Error revocando sesión", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo cerrar la sesión." });
  }
});

app.post("/api/account/sessions/revoke-others", requireAuth, async (req, res) => {
  try {
    await removeAllActiveSessions(req.session.user.id, req.sessionID);
    await pool.query(
      "DELETE FROM sessions WHERE session_id <> ? AND data LIKE ?",
      [req.sessionID, '%"user":{"id":' + Number(req.session.user.id) + ',%']
    );
    await writeAudit(req, "sessions_revoked_others", "user", req.session.user.id);
    res.json({ success: true, message: "Las demás sesiones fueron cerradas." });
  } catch (error) {
    logError("Error cerrando sesiones", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudieron cerrar las demás sesiones." });
  }
});

// =========================================================
// V2 — 2FA TOTP PARA ADMIN
// =========================================================

app.get("/api/account/2fa/status", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT role, totp_enabled FROM users WHERE id=? LIMIT 1", [req.session.user.id]);
    res.json({ success: true, enabled: Boolean(rows[0]?.totp_enabled), required: rows[0]?.role === "admin" });
  } catch (error) {
    res.status(500).json({ success: false, error: "No se pudo consultar 2FA." });
  }
});

app.post("/api/account/2fa/setup", requireAuth, authLimiter, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const [rows] = await pool.query("SELECT password_hash, role, totp_enabled FROM users WHERE id=? LIMIT 1", [req.session.user.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: "Usuario no encontrado." });
    if (rows[0].role !== "admin") return res.status(403).json({ success: false, error: "2FA está reservado para administradores." });
    if (rows[0].totp_enabled) return res.status(400).json({ success: false, error: "2FA ya está habilitado." });
    if (!await bcrypt.compare(currentPassword, rows[0].password_hash)) return res.status(401).json({ success: false, error: "La contraseña actual es incorrecta." });

    const secret = generateTotpSecret();
    const encrypted = encryptSecret(secret, process.env.SESSION_SECRET);
    await pool.query("UPDATE users SET totp_secret=? WHERE id=?", [encrypted, req.session.user.id]);

    const issuer = "JR Electricidad";
    const label = `${issuer}:${req.session.user.email}`;
    const otpauth = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    res.json({ success: true, secret, otpauth_uri: otpauth });
  } catch (error) {
    logError("Error preparando 2FA", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo preparar 2FA." });
  }
});

app.post("/api/account/2fa/enable", requireAuth, authLimiter, async (req, res) => {
  try {
    const code = String(req.body.code || "");
    const [rows] = await pool.query("SELECT totp_secret, totp_enabled, role FROM users WHERE id=? LIMIT 1", [req.session.user.id]);
    if (!rows.length || rows[0].role !== "admin") return res.status(403).json({ success: false, error: "Acceso no autorizado." });
    if (rows[0].totp_enabled) return res.status(400).json({ success: false, error: "2FA ya está habilitado." });
    if (!rows[0].totp_secret) return res.status(400).json({ success: false, error: "Primero generá la configuración de 2FA." });

    const secret = decryptSecret(rows[0].totp_secret, process.env.SESSION_SECRET);
    if (!verifyTotp(secret, code)) return res.status(401).json({ success: false, error: "Código 2FA inválido." });

    const backupCodes = generateBackupCodes();
    await pool.query("DELETE FROM mfa_backup_codes WHERE user_id=?", [req.session.user.id]);
    for (const backup of backupCodes) {
      await pool.query("INSERT INTO mfa_backup_codes (user_id, code_hash) VALUES (?, ?)", [req.session.user.id, hashBackupCode(backup)]);
    }
    await pool.query("UPDATE users SET totp_enabled=1 WHERE id=?", [req.session.user.id]);
    await writeAudit(req, "2fa_enabled", "user", req.session.user.id);

    res.json({ success: true, message: "2FA habilitado correctamente.", backup_codes: backupCodes });
  } catch (error) {
    logError("Error habilitando 2FA", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo habilitar 2FA." });
  }
});

app.post("/api/account/2fa/disable", requireAuth, authLimiter, async (req, res) => {
  try {
    const password = String(req.body.password || "");
    const code = String(req.body.code || "");
    const [rows] = await pool.query("SELECT password_hash, totp_secret, totp_enabled, role FROM users WHERE id=? LIMIT 1", [req.session.user.id]);
    if (!rows.length || rows[0].role !== "admin") return res.status(403).json({ success: false, error: "Acceso no autorizado." });
    if (!rows[0].totp_enabled) return res.status(400).json({ success: false, error: "2FA no está habilitado." });
    if (!await bcrypt.compare(password, rows[0].password_hash)) return res.status(401).json({ success: false, error: "La contraseña actual es incorrecta." });

    const secret = decryptSecret(rows[0].totp_secret, process.env.SESSION_SECRET);
    if (!verifyTotp(secret, code)) return res.status(401).json({ success: false, error: "Código 2FA inválido." });

    await pool.query("UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?", [req.session.user.id]);
    await pool.query("DELETE FROM mfa_backup_codes WHERE user_id=?", [req.session.user.id]);
    await writeAudit(req, "2fa_disabled", "user", req.session.user.id);
    res.json({ success: true, message: "2FA deshabilitado correctamente." });
  } catch (error) {
    logError("Error deshabilitando 2FA", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo deshabilitar 2FA." });
  }
});

app.post("/api/login/2fa", authLimiter, async (req, res) => {
  try {
    const pending = req.session.pending2fa;
    if (!pending || Date.now() - pending.createdAt > 5 * 60 * 1000) {
      return res.status(401).json({ success: false, error: "El desafío 2FA venció. Iniciá sesión nuevamente." });
    }

    const code = String(req.body.code || "").trim();
    const [rows] = await pool.query("SELECT id,name,email,role,totp_secret,totp_enabled FROM users WHERE id=? LIMIT 1", [pending.userId]);
    if (!rows.length || rows[0].role !== "admin" || !rows[0].totp_enabled) {
      return res.status(401).json({ success: false, error: "Desafío 2FA inválido." });
    }

    const secret = decryptSecret(rows[0].totp_secret, process.env.SESSION_SECRET);
    let valid = verifyTotp(secret, code);
    if (!valid && code) {
      const hash = hashBackupCode(code);
      const [codes] = await pool.query("SELECT id FROM mfa_backup_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL LIMIT 1", [pending.userId, hash]);
      if (codes.length) {
        await pool.query("UPDATE mfa_backup_codes SET used_at=NOW() WHERE id=?", [codes[0].id]);
        valid = true;
      }
    }

    if (!valid) {
      await writeAudit(req, "2fa_failed", "user", pending.userId);
      return res.status(401).json({ success: false, error: "Código 2FA inválido." });
    }

    const user = { id: rows[0].id, name: rows[0].name, email: rows[0].email, role: rows[0].role };
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.user = user;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    await registerActiveSession(req, user.id);
    await writeAudit(req, "login", "user", user.id, { mfa: true });
    res.json({ success: true, ok: true, user: cleanUser(user) });
  } catch (error) {
    logError("Error verificando 2FA", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo verificar 2FA." });
  }
});

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

  await pool.query(
    "DELETE FROM active_sessions WHERE last_seen_at < DATE_SUB(NOW(), INTERVAL 8 HOUR)"
  ).catch(error => {
    logError("No se pudieron limpiar sesiones activas vencidas", { error: error.message });
  });

  try {

    await pool.query(
      "SELECT 1"
    );


    console.log(
      "✅ MySQL conectado"
    );
	// =====================================================
// =====================================================
// FASE 8 — GESTIÓN AVANZADA DE TRABAJOS
// =====================================================

const JOB_STATUSES = [
  "pendiente_presupuesto",
  "presupuesto_enviado",
  "aceptado",
  "programado",
  "en_proceso",
  "pausado",
  "finalizado",
  "cerrado",
  "rechazado",
  "cancelado"
];

const JOB_TRANSITIONS = {
  pendiente_presupuesto:["presupuesto_enviado","rechazado","cancelado"],
  presupuesto_enviado:["aceptado","rechazado","cancelado"],
  aceptado:["programado","en_proceso","cancelado"],
  programado:["en_proceso","cancelado"],
  en_proceso:["pausado","finalizado","cancelado"],
  pausado:["en_proceso","cancelado"],
  finalizado:["cerrado"],
  cerrado:[],
  rechazado:[],
  cancelado:[]
};

const jobUpload = multer({
  storage,
  limits:{fileSize:10*1024*1024},
  fileFilter:(req,file,cb)=>{
    const allowed=[
      "image/jpeg","image/png","image/webp","image/gif",
      "application/pdf","text/plain",
      "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ];
    if(!allowed.includes(file.mimetype)) return cb(new Error("Tipo de archivo no permitido."));
    cb(null,true);
  }
});

function validateJobId(value){
  const id=Number(value);
  return Number.isInteger(id)&&id>0?id:null;
}

function validateJobStatus(value){
  const status=String(value||"").trim();
  return JOB_STATUSES.includes(status)?status:null;
}

function validateJobDateTime(value){
  if(value==null||String(value).trim()==="") return null;
  const text=String(value).trim();
  if(!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(text)) return undefined;
  return text.replace("T"," ");
}

async function recordJobHistory(req,jobId,action,oldStatus=null,newStatus=null,metadata=null,db=pool){
  await db.query(
    `INSERT INTO job_history
      (job_id,actor_user_id,action,old_status,new_status,metadata)
     VALUES (?,?,?,?,?,?)`,
    [jobId,req.session?.user?.id||null,action,oldStatus,newStatus,metadata?JSON.stringify(metadata):null]
  );
}

async function createJobNotification(type,quoteId,message,jobId,userId=null,priority="normal"){
  try {
    await createAdminNotification({
      type,
      quoteId,
      message,
      userId,
      entityType: "job",
      entityId: jobId,
      linkUrl: "/admin.html#jobsSection",
      priority
    });
  } catch(error) {
    logError("No se pudo crear notificación de trabajo",{error:error.message,quoteId,jobId,userId});
  }
}

// Lista de trabajos.
app.get("/api/admin/jobs",requireAdmin,async(req,res)=>{
  try{
    const search=String(req.query.search||"").trim();
    const status=String(req.query.status||"").trim();
    const assignedUserId=String(req.query.assigned_user_id||"").trim();
    const dateFrom=String(req.query.date_from||"").trim();
    const dateTo=String(req.query.date_to||"").trim();

    if(status&&!validateJobStatus(status)) return res.status(400).json({error:"Estado de trabajo inválido."});

    const params=[];
    let sql=`
      SELECT j.id,j.quote_id,j.status,j.started_at,j.completed_at,j.created_at,j.updated_at,
             j.assigned_user_id,j.scheduled_at,j.internal_notes,j.execution_notes,j.completion_notes,j.location,
             q.quote_number,q.issue_date,q.subtotal,q.discount,q.total,q.notes,
             qr.name AS client_name,qr.phone AS client_phone,qr.email AS client_email,
             qr.service AS requested_service,qr.description AS work_description,qr.preferred_date,
             u.name AS assigned_user_name
      FROM jobs j
      INNER JOIN quotes q ON q.id=j.quote_id
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN users u ON u.id=j.assigned_user_id
      WHERE 1=1`;

    if(search){
      const v=`%${search}%`;
      sql+=` AND (qr.name LIKE ? OR qr.phone LIKE ? OR qr.email LIKE ? OR q.quote_number LIKE ? OR qr.service LIKE ? OR qr.description LIKE ?)`;
      params.push(v,v,v,v,v,v);
    }
    if(status){sql+=" AND j.status=?";params.push(status);}
    if(assignedUserId){
      const id=Number(assignedUserId);
      if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:"Técnico inválido."});
      sql+=" AND j.assigned_user_id=?";params.push(id);
    }
    if(dateFrom){if(!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom))return res.status(400).json({error:"Fecha desde inválida."});sql+=" AND DATE(COALESCE(j.scheduled_at,j.created_at))>=?";params.push(dateFrom);}
    if(dateTo){if(!/^\d{4}-\d{2}-\d{2}$/.test(dateTo))return res.status(400).json({error:"Fecha hasta inválida."});sql+=" AND DATE(COALESCE(j.scheduled_at,j.created_at))<=?";params.push(dateTo);}
    sql+=" ORDER BY FIELD(j.status,'programado','en_proceso','pausado','finalizado','aceptado','pendiente_presupuesto','presupuesto_enviado','cerrado','rechazado','cancelado'),COALESCE(j.scheduled_at,j.created_at) ASC,j.id DESC";

    const [jobs]=await pool.query(sql,params);
    res.json({success:true,jobs});
  }catch(error){
    logError("Error obteniendo trabajos V2",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron obtener los trabajos."});
  }
});

// Detalle completo.
app.get("/api/admin/jobs/:id(\\d+)",requireAdmin,async(req,res)=>{
  try{
    const id=validateJobId(req.params.id);
    if(!id)return res.status(400).json({error:"ID de trabajo inválido."});
    const [rows]=await pool.query(`
      SELECT j.*,q.quote_number,q.issue_date,q.expiration_date,q.notes,q.subtotal,q.discount,q.total,
             qr.name AS client_name,qr.phone AS client_phone,qr.email AS client_email,
             qr.service AS requested_service,qr.description AS work_description,qr.preferred_date,
             c.address AS client_address,c.locality AS client_locality,u.name AS assigned_user_name
      FROM jobs j
      INNER JOIN quotes q ON q.id=j.quote_id
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN clients c ON c.id=qr.client_id
      LEFT JOIN users u ON u.id=j.assigned_user_id
      WHERE j.id=? LIMIT 1`,[id]);
    if(!rows.length)return res.status(404).json({error:"Trabajo no encontrado."});

    const [items]=await pool.query("SELECT id,description,quantity,unit,unit_price,total FROM quote_items WHERE quote_id=? ORDER BY id",[rows[0].quote_id]);
    const [history]=await pool.query(`
      SELECT h.*,u.name AS actor_name FROM job_history h
      LEFT JOIN users u ON u.id=h.actor_user_id
      WHERE h.job_id=? ORDER BY h.created_at DESC,h.id DESC`,[id]);
    const [attachments]=await pool.query(`
      SELECT id,original_name,url,mime_type,size_bytes,category,created_at
      FROM job_attachments WHERE job_id=? ORDER BY created_at DESC,id DESC`,[id]);

    res.json({success:true,job:{...rows[0],items,history,attachments}});
  }catch(error){
    logError("Error obteniendo detalle de trabajo",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el trabajo."});
  }
});

// Técnicos disponibles.
app.get("/api/admin/jobs/assignees",requireAdmin,async(req,res)=>{
  try{
    const [rows]=await pool.query("SELECT id,name,email FROM users ORDER BY name");
    res.json({success:true,users:rows});
  }catch(error){res.status(500).json({error:"No se pudieron obtener los técnicos."});}
});

// Actualizar datos operativos.
app.put("/api/admin/jobs/:id(\\d+)",requireAdmin,adminMutationLimiter,async(req,res)=>{
  try{
    const id=validateJobId(req.params.id);
    if(!id)return res.status(400).json({error:"ID de trabajo inválido."});
    const [rows]=await pool.query("SELECT * FROM jobs WHERE id=? LIMIT 1",[id]);
    if(!rows.length)return res.status(404).json({error:"Trabajo no encontrado."});
    const current=rows[0];
    if(["cerrado","cancelado","rechazado"].includes(current.status))return res.status(409).json({error:"Este trabajo ya está cerrado o cancelado."});

    let assigned=current.assigned_user_id;
    if(req.body.assigned_user_id!==undefined){
      assigned=req.body.assigned_user_id===""||req.body.assigned_user_id===null?null:Number(req.body.assigned_user_id);
      if(assigned!==null&&(!Number.isInteger(assigned)||assigned<=0))return res.status(400).json({error:"Técnico inválido."});
      if(assigned!==null){const [u]=await pool.query("SELECT id FROM users WHERE id=? LIMIT 1",[assigned]);if(!u.length)return res.status(400).json({error:"El técnico no existe."});}
    }
    const scheduled=req.body.scheduled_at===undefined?current.scheduled_at:validateJobDateTime(req.body.scheduled_at);
    if(scheduled===undefined)return res.status(400).json({error:"Fecha programada inválida."});
    const fields={
      assigned_user_id:assigned,
      scheduled_at:scheduled,
      internal_notes:req.body.internal_notes===undefined?current.internal_notes:String(req.body.internal_notes||"").slice(0,10000),
      execution_notes:req.body.execution_notes===undefined?current.execution_notes:String(req.body.execution_notes||"").slice(0,10000),
      location:req.body.location===undefined?current.location:String(req.body.location||"").slice(0,255)
    };
    await pool.query(`UPDATE jobs SET assigned_user_id=?,scheduled_at=?,internal_notes=?,execution_notes=?,location=? WHERE id=?`,
      [fields.assigned_user_id,fields.scheduled_at,fields.internal_notes,fields.execution_notes,fields.location,id]);
    await recordJobHistory(req,id,"job_updated",current.status,current.status,{changes:fields});
    await writeAudit(req,"job_updated","job",id,fields);

    if (String(current.assigned_user_id || "") !== String(fields.assigned_user_id || "")) {
      if (fields.assigned_user_id) {
        await createJobNotification(
          "job_assigned",
          current.quote_id,
          `El trabajo #${id} fue asignado a tu usuario.`,
          id,
          fields.assigned_user_id,
          "high"
        );
      } else {
        await createJobNotification(
          "job_status_changed",
          current.quote_id,
          `El trabajo #${id} quedó sin técnico asignado.`,
          id,
          null,
          "normal"
        );
      }
    }

    if (String(current.scheduled_at || "") !== String(fields.scheduled_at || "") && fields.scheduled_at) {
      await createJobNotification(
        "job_scheduled",
        current.quote_id,
        `El trabajo #${id} fue programado para ${new Date(fields.scheduled_at).toLocaleString("es-AR")}.`,
        id,
        fields.assigned_user_id || null,
        "high"
      );
    }
      await notifyJobCustomer(id, current.status, fields.scheduled_at);
      await notifyJobWhatsApp(id, current.status, fields.scheduled_at);

    res.json({success:true,message:"Trabajo actualizado correctamente."});
  }catch(error){
    logError("Error actualizando trabajo",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el trabajo."});
  }
});

// Cambiar estado con transiciones controladas.
app.put("/api/admin/jobs/:id(\\d+)/status",requireAdmin,adminMutationLimiter,async(req,res)=>{
  const connection=await pool.getConnection();
  try{
    const id=validateJobId(req.params.id);
    const next=validateJobStatus(req.body?.status);
    if(!id||!next){connection.release();return res.status(400).json({error:"ID o estado de trabajo inválido."});}
    const [rows]=await connection.query("SELECT * FROM jobs WHERE id=? LIMIT 1 FOR UPDATE",[id]);
    if(!rows.length){connection.release();return res.status(404).json({error:"Trabajo no encontrado."});}
    const job=rows[0];
    if(job.status===next){connection.release();return res.json({success:true,status:next,message:"El trabajo ya se encuentra en ese estado."});}
    if(!(JOB_TRANSITIONS[job.status]||[]).includes(next)){
      connection.release();return res.status(409).json({error:"No se puede cambiar a ese estado desde el estado actual."});
    }

    const nowFields=[];
    const values=[];
    if(next==="en_proceso"){
      nowFields.push("started_at=COALESCE(started_at,NOW())","started_by_user_id=?");values.push(req.session.user.id);
    }
    if(next==="finalizado"){
      nowFields.push("completed_at=COALESCE(completed_at,NOW())","completed_by_user_id=?");values.push(req.session.user.id);
    }
    if(next==="cerrado" && !job.completed_at){
      nowFields.push("completed_at=NOW()","completed_by_user_id=?");values.push(req.session.user.id);
    }
    nowFields.push("status=?");values.push(next,id);
    await connection.query(`UPDATE jobs SET ${nowFields.join(",")} WHERE id=?`,values);
    await recordJobHistory(req,id,"status_changed",job.status,next,null,connection);
    await connection.commit();

    const messages={
      programado:"Trabajo programado correctamente.",
      en_proceso:"Trabajo iniciado correctamente.",
      pausado:"Trabajo pausado correctamente.",
      finalizado:"Trabajo marcado como finalizado.",
      cerrado:"Trabajo cerrado correctamente.",
      cancelado:"Trabajo cancelado correctamente."
    };
    const notificationType =
      next === "cerrado" ? "job_closed" :
      next === "finalizado" ? "job_finished" :
      next === "en_proceso" ? "job_started" :
      "job_status_changed";
    const notificationPriority =
      ["finalizado","cerrado","en_proceso"].includes(next) ? "high" :
      ["programado","pausado"].includes(next) ? "normal" : "low";
    await createJobNotification(
      notificationType,
      job.quote_id,
      `El trabajo #${id} pasó de ${job.status} a ${next}.`,
      id,
      job.assigned_user_id || null,
      notificationPriority
    );
    await notifyJobCustomer(id, next, next === "programado" ? job.scheduled_at : null);
    await notifyJobWhatsApp(id, next, next === "programado" ? job.scheduled_at : null);
    await writeAudit(req,"job_status_changed","job",id,{old_status:job.status,new_status:next});
    res.json({success:true,status:next,message:messages[next]||"Estado actualizado correctamente."});
  }catch(error){
    await connection.rollback().catch(()=>{});
    logError("Error actualizando estado de trabajo",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el estado del trabajo."});
  }finally{connection.release();}
});

// Historial.
app.get("/api/admin/jobs/:id(\\d+)/history",requireAdmin,async(req,res)=>{
  try{
    const id=validateJobId(req.params.id);if(!id)return res.status(400).json({error:"ID inválido."});
    const [rows]=await pool.query(`
      SELECT h.*,u.name AS actor_name FROM job_history h
      LEFT JOIN users u ON u.id=h.actor_user_id
      WHERE h.job_id=? ORDER BY h.created_at DESC,h.id DESC`,[id]);
    res.json({success:true,history:rows});
  }catch(error){res.status(500).json({error:"No se pudo obtener el historial."});}
});

// Subir evidencia/documento.
app.post("/api/admin/jobs/:id(\\d+)/attachments",requireAdmin,jobUpload.single("file"),async(req,res)=>{
  try{
    const id=validateJobId(req.params.id);if(!id)return res.status(400).json({error:"ID inválido."});
    const [rows]=await pool.query("SELECT id FROM jobs WHERE id=? LIMIT 1",[id]);
    if(!rows.length){if(req.file)fs.unlink(req.file.path,()=>{});return res.status(404).json({error:"Trabajo no encontrado."});}
    if(!req.file)return res.status(400).json({error:"No se recibió ningún archivo."});
    const allowedCategories=["inicio","proceso","final","documento","otro"];
    const category=allowedCategories.includes(String(req.body.category||""))?String(req.body.category):"otro";
    const url="/uploads/"+req.file.filename;
    const [result]=await pool.query(`
      INSERT INTO job_attachments
      (job_id,uploaded_by_user_id,original_name,stored_name,url,mime_type,size_bytes,category)
      VALUES (?,?,?,?,?,?,?,?)`,
      [id,req.session.user.id,req.file.originalname,req.file.filename,url,req.file.mimetype,req.file.size,category]
    );
    await recordJobHistory(req,id,"attachment_added",null,null,{attachment_id:result.insertId,category,name:req.file.originalname});
    await writeAudit(req,"job_attachment_added","job",id,{attachment_id:result.insertId,category});
    res.status(201).json({success:true,id:result.insertId,url,message:"Archivo adjuntado correctamente."});
  }catch(error){
    if(req.file)fs.unlink(req.file.path,()=>{});
    logError("Error subiendo evidencia de trabajo",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo adjuntar el archivo."});
  }
});

// Eliminar evidencia.
app.delete("/api/admin/jobs/:id(\\d+)/attachments/:attachmentId(\\d+)",requireAdmin,adminMutationLimiter,async(req,res)=>{
  try{
    const jobId=validateJobId(req.params.id),attachmentId=validateJobId(req.params.attachmentId);
    if(!jobId||!attachmentId)return res.status(400).json({error:"ID inválido."});
    const [rows]=await pool.query("SELECT * FROM job_attachments WHERE id=? AND job_id=? LIMIT 1",[attachmentId,jobId]);
    if(!rows.length)return res.status(404).json({error:"Archivo no encontrado."});
    const [[publishedGallery]]=await pool.query(
      "SELECT id FROM gallery WHERE source_job_attachment_id=? LIMIT 1",
      [attachmentId]
    );
    if(publishedGallery){
      return res.status(409).json({
        error:"Esta evidencia está publicada en la galería. Eliminá primero la publicación de galería."
      });
    }
    await pool.query("DELETE FROM job_attachments WHERE id=?",[attachmentId]);
    if(rows[0].stored_name)fs.unlink(path.join(uploadsDir,rows[0].stored_name),()=>{});
    await recordJobHistory(req,jobId,"attachment_deleted",null,null,{attachment_id:attachmentId});
    await writeAudit(req,"job_attachment_deleted","job",jobId,{attachment_id:attachmentId});
    res.json({success:true,message:"Archivo eliminado."});
  }catch(error){res.status(500).json({error:"No se pudo eliminar el archivo."});}
});

// Historial cerrado con filtros.
app.get("/api/admin/jobs-history",requireAdmin,async(req,res)=>{
  try{
    const search=String(req.query.search||"").trim();
    const dateFrom=String(req.query.date_from||"").trim();
    const dateTo=String(req.query.date_to||"").trim();
    const params=[];
    let sql=`
      SELECT j.id,j.quote_id,j.status,j.started_at,j.completed_at,j.created_at,j.updated_at,
             j.scheduled_at,j.location,j.assigned_user_id,u.name AS assigned_user_name,
             q.quote_number,q.issue_date,q.subtotal,q.discount,q.total,q.notes,
             qr.name AS client_name,qr.phone AS client_phone,qr.email AS client_email,
             qr.service AS requested_service,qr.description AS work_description
      FROM jobs j
      INNER JOIN quotes q ON q.id=j.quote_id
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN users u ON u.id=j.assigned_user_id
      WHERE j.status IN ('cerrado','finalizado')`;
    if(search){const v=`%${search}%`;sql+=" AND (qr.name LIKE ? OR qr.phone LIKE ? OR qr.email LIKE ? OR q.quote_number LIKE ? OR qr.service LIKE ? OR qr.description LIKE ?)";params.push(v,v,v,v,v,v);}
    if(dateFrom){if(!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom))return res.status(400).json({error:"Fecha desde inválida."});sql+=" AND DATE(COALESCE(j.completed_at,j.created_at))>=?";params.push(dateFrom);}
    if(dateTo){if(!/^\d{4}-\d{2}-\d{2}$/.test(dateTo))return res.status(400).json({error:"Fecha hasta inválida."});sql+=" AND DATE(COALESCE(j.completed_at,j.created_at))<=?";params.push(dateTo);}
    sql+=" ORDER BY COALESCE(j.completed_at,j.created_at) DESC,j.id DESC";
    const [jobs]=await pool.query(sql,params);
    res.json({success:true,jobs,summary:{count:jobs.length,total:jobs.reduce((sum,row)=>sum+Number(row.total||0),0)}});
  }catch(error){logError("Error obteniendo historial de trabajos",{requestId:req.requestId,error:error.message});res.status(500).json({error:"No se pudo obtener el historial."});}
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
// SOLICITUDES - ADMIN V2
// ========================================

const REQUEST_STATUSES = [
  "nueva",
  "en_revision",
  "presupuestando",
  "presupuestada",
  "aceptada",
  "programada",
  "en_trabajo",
  "finalizada",
  "cerrada"
];

const REQUEST_PRIORITIES = [
  "baja",
  "normal",
  "alta",
  "urgente"
];

function validateRequestId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateRequestStatus(status) {
  return REQUEST_STATUSES.includes(String(status || "").trim());
}

function validateRequestPriority(priority) {
  return REQUEST_PRIORITIES.includes(String(priority || "").trim());
}

function validateOptionalDateTime(value) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text) &&
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text)) {
    return undefined;
  }
  return text.replace("T", " ");
}

async function recordRequestHistory(req, requestId, action, oldStatus, newStatus, metadata = null) {
  await pool.query(
    `INSERT INTO quote_request_history
      (quote_request_id, actor_user_id, action, old_status, new_status, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      requestId,
      req.session?.user?.id || null,
      action,
      oldStatus || null,
      newStatus || null,
      metadata ? JSON.stringify(metadata) : null
    ]
  );
}

async function notifyRequestWhatsApp(request, message, entityType="quote_request") {
  try {
    const settings=await whatsappBusinessEnabled();
    if(!settings?.whatsapp_auto_notifications || !request?.whatsapp && !request?.phone) return false;
    const phone=request.whatsapp || request.phone;
    await queueWhatsApp({
      to:phone,
      message,
      requestId:null,
      entityType,
      entityId:request.id
    });
    return true;
  } catch(error) {
    logError("No se pudo encolar WhatsApp de cliente",{requestId:null,error:error.message,entityId:request?.id});
    return false;
  }
}

async function notifyRequestCustomer(request, subject, message) {
  if (!request?.email) return false;
  try {
    const template = String(subject || "").toLowerCase().includes("recibida")
      ? "request_received"
      : "request_status";
    await queueEmail({
      to: request.email,
      subject,
      template,
      data: {
        name: request.name,
        requestId: request.id,
        status: request.status,
        service: request.service,
        message
      },
      requestId: null
    });
    return true;
  } catch (error) {
    logError("No se pudo encolar notificación al cliente", {
      requestId: null,
      error: error.message,
      quoteRequestId: request.id
    });
    return false;
  }
}

async function notifyJobWhatsApp(jobId, status, scheduledAt = null) {
  try {
    const settings=await whatsappBusinessEnabled();
    if(!settings?.whatsapp_auto_notifications) return false;
    const [rows]=await pool.query(
      `SELECT j.id,qr.phone,qr.whatsapp,qr.name
       FROM jobs j
       INNER JOIN quotes q ON q.id=j.quote_id
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE j.id=? LIMIT 1`,[jobId]
    );
    const job=rows[0];
    const phone=job?.whatsapp || job?.phone;
    if(!phone) return false;
    let message=`JR Electricidad: el trabajo #${jobId} está en estado ${String(status).replace(/_/g," ")}.`;
    if(scheduledAt) message+=` Programado para ${new Date(scheduledAt).toLocaleString("es-AR").replace(",", "")}.`;
    await queueWhatsApp({to:phone,message,entityType:"job",entityId:jobId});
    return true;
  } catch(error) {
    logError("No se pudo encolar WhatsApp del trabajo",{requestId:null,error:error.message,jobId});
    return false;
  }
}

async function notifyJobCustomer(jobId, status, scheduledAt = null) {
  try {
    const [rows] = await pool.query(
      `SELECT j.id,j.status,qr.name,qr.email
       FROM jobs j
       INNER JOIN quotes q ON q.id=j.quote_id
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE j.id=? LIMIT 1`,
      [jobId]
    );
    const job=rows[0];
    if(!job?.email) return false;
    await queueEmail({
      to: job.email,
      subject: "Actualización de trabajo #" + jobId + " - JR Electricidad",
      template: "job_update",
      data: {
        name: job.name,
        jobId,
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toLocaleString("es-AR") : null
      }
    });
    return true;
  } catch(error) {
    logError("No se pudo encolar actualización del trabajo al cliente", {
      requestId:null,
      jobId,
      error:error.message
    });
    return false;
  }
}

// Listar solicitudes con búsqueda, estado, prioridad, técnico y fechas.
app.get("/api/admin/quote-requests", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const priority = String(req.query.priority || "").trim();
    const assignedUserId = String(req.query.assigned_user_id || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    if (status && !validateRequestStatus(status)) {
      return res.status(400).json({ error: "Estado de solicitud inválido." });
    }
    if (priority && !validateRequestPriority(priority)) {
      return res.status(400).json({ error: "Prioridad inválida." });
    }

    const params = [];
    let sql = `
      SELECT
        qr.id, qr.client_id, qr.name, qr.phone, qr.email, qr.service,
        qr.description, qr.preferred_date, qr.image_url, qr.status,
        qr.priority, qr.assigned_user_id, qr.scheduled_at,
        qr.internal_notes, qr.closed_at, qr.created_at, qr.updated_at,
        u.name AS assigned_user_name,
        c.locality AS client_locality,
        (SELECT COUNT(*) FROM quote_request_attachments a WHERE a.quote_request_id=qr.id) AS attachments_count,
        (SELECT COUNT(*) FROM quote_request_history h WHERE h.quote_request_id=qr.id) AS history_count,
        q.id AS quote_id,
        q.quote_number,
        j.id AS job_id,
        j.status AS job_status
      FROM quote_requests qr
      LEFT JOIN users u ON u.id=qr.assigned_user_id
      LEFT JOIN clients c ON c.id=qr.client_id
      LEFT JOIN quotes q ON q.quote_request_id=qr.id
      LEFT JOIN jobs j ON j.quote_id=q.id
      WHERE 1=1
    `;

    if (search) {
      const value = `%${search}%`;
      sql += ` AND (
        qr.name LIKE ? OR qr.phone LIKE ? OR qr.email LIKE ? OR
        qr.service LIKE ? OR qr.description LIKE ? OR c.locality LIKE ?
      )`;
      params.push(value, value, value, value, value, value);
    }

    if (status) {
      sql += " AND qr.status=?";
      params.push(status);
    }

    if (priority) {
      sql += " AND qr.priority=?";
      params.push(priority);
    }

    if (assignedUserId) {
      const id = Number(assignedUserId);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Técnico asignado inválido." });
      }
      sql += " AND qr.assigned_user_id=?";
      params.push(id);
    }

    if (dateFrom) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
        return res.status(400).json({ error: "La fecha desde no es válida." });
      }
      sql += " AND DATE(qr.created_at)>=?";
      params.push(dateFrom);
    }

    if (dateTo) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
        return res.status(400).json({ error: "La fecha hasta no es válida." });
      }
      sql += " AND DATE(qr.created_at)<=?";
      params.push(dateTo);
    }

    sql += " ORDER BY FIELD(qr.priority,'urgente','alta','normal','baja'), qr.created_at DESC, qr.id DESC";

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo solicitudes V2", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener las solicitudes." });
  }
});

// Obtener una solicitud completa.
app.get("/api/admin/quote-requests/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID de solicitud inválido." });

    const [rows] = await pool.query(
      `SELECT
        qr.*,
        u.name AS assigned_user_name,
        c.locality AS client_locality,
        c.address AS client_address,
        q.id AS quote_id,
        q.quote_number,
        j.id AS job_id,
        j.status AS job_status
       FROM quote_requests qr
       LEFT JOIN users u ON u.id=qr.assigned_user_id
       LEFT JOIN clients c ON c.id=qr.client_id
       LEFT JOIN quotes q ON q.quote_request_id=qr.id
       LEFT JOIN jobs j ON j.quote_id=q.id
       WHERE qr.id=? LIMIT 1`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: "Solicitud no encontrada." });

    const [history] = await pool.query(
      `SELECT h.*, u.name AS actor_name
       FROM quote_request_history h
       LEFT JOIN users u ON u.id=h.actor_user_id
       WHERE h.quote_request_id=?
       ORDER BY h.created_at DESC, h.id DESC`,
      [id]
    );

    const [attachments] = await pool.query(
      `SELECT id, original_name, url, mime_type, size_bytes, created_at
       FROM quote_request_attachments
       WHERE quote_request_id=?
       ORDER BY created_at DESC, id DESC`,
      [id]
    );

    res.json({
      ...rows[0],
      history,
      attachments
    });
  } catch (error) {
    logError("Error obteniendo detalle de solicitud", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo obtener la solicitud." });
  }
});

// Actualizar estado/prioridad/técnico/agenda/notas.
app.patch("/api/admin/quote-requests/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = validateRequestId(req.params.id);
    if (!id) {
      connection.release();
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    const [existingRows] = await connection.query(
      "SELECT * FROM quote_requests WHERE id=? LIMIT 1 FOR UPDATE",
      [id]
    );

    if (!existingRows.length) {
      connection.release();
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const current = existingRows[0];
    const body = req.body || {};

    let status = body.status === undefined ? current.status : String(body.status || "").trim();
    let priority = body.priority === undefined ? current.priority : String(body.priority || "").trim();

    if (!validateRequestStatus(status)) {
      connection.release();
      return res.status(400).json({ error: "Estado de solicitud inválido." });
    }

    if (!validateRequestPriority(priority)) {
      connection.release();
      return res.status(400).json({ error: "Prioridad inválida." });
    }

    let assignedUserId = current.assigned_user_id;
    if (body.assigned_user_id !== undefined && body.assigned_user_id !== null && String(body.assigned_user_id).trim() !== "") {
      assignedUserId = Number(body.assigned_user_id);
      if (!Number.isInteger(assignedUserId) || assignedUserId <= 0) {
        connection.release();
        return res.status(400).json({ error: "Técnico asignado inválido." });
      }
      const [userRows] = await connection.query("SELECT id FROM users WHERE id=? LIMIT 1", [assignedUserId]);
      if (!userRows.length) {
        connection.release();
        return res.status(400).json({ error: "El técnico asignado no existe." });
      }
    } else if (body.assigned_user_id === null || String(body.assigned_user_id || "").trim() === "") {
      assignedUserId = null;
    }

    const scheduledAt = body.scheduled_at === undefined
      ? current.scheduled_at
      : validateOptionalDateTime(body.scheduled_at);

    if (scheduledAt === undefined) {
      connection.release();
      return res.status(400).json({ error: "La fecha programada no es válida." });
    }

    const internalNotes = body.internal_notes === undefined
      ? String(current.internal_notes || "")
      : String(body.internal_notes || "").trim();

    if (internalNotes.length > 10000) {
      connection.release();
      return res.status(400).json({ error: "Las notas internas no pueden superar 10000 caracteres." });
    }

    const closedAt = status === "cerrada" || status === "finalizada"
      ? (current.closed_at || new Date())
      : null;

    await connection.beginTransaction();

    await connection.query(
      `UPDATE quote_requests
       SET status=?, priority=?, assigned_user_id=?, scheduled_at=?, internal_notes=?, closed_at=?
       WHERE id=?`,
      [status, priority, assignedUserId, scheduledAt, internalNotes || null, closedAt, id]
    );

    if (
      String(current.status) !== status ||
      String(current.priority || "normal") !== priority ||
      Number(current.assigned_user_id || 0) !== Number(assignedUserId || 0) ||
      String(current.scheduled_at || "") !== String(scheduledAt || "") ||
      String(current.internal_notes || "") !== internalNotes
    ) {
      await connection.query(
        `INSERT INTO quote_request_history
          (quote_request_id, actor_user_id, action, old_status, new_status, metadata)
         VALUES (?, ?, 'request_updated', ?, ?, ?)`,
        [
          id,
          req.session.user.id,
          current.status,
          status,
          JSON.stringify({
            priority,
            assigned_user_id: assignedUserId,
            scheduled_at: scheduledAt,
            internal_notes_changed: String(current.internal_notes || "") !== internalNotes
          })
        ]
      );
    }

    await connection.commit();
    connection.release();

    await writeAudit(req, "request_updated", "quote_request", id, {
      status,
      priority,
      assigned_user_id: assignedUserId,
      scheduled_at: scheduledAt
    });

    if (String(current.status) !== status) {
      await createAdminNotification({
        type: "quote_request_status",
        message: `La solicitud #${id} cambió de "${current.status}" a "${status}".`,
        entityType: "quote_request",
        entityId: id,
        linkUrl: "/admin.html#quoteRequestsSection",
        priority: ["urgente","alta"].includes(String(priority)) ? "high" : "normal"
      }).catch(() => {});

      const [requestRows] = await pool.query(
        "SELECT id,name,email,phone,whatsapp,service,status FROM quote_requests WHERE id=? LIMIT 1",
        [id]
      );
      if (requestRows.length) {
        await notifyRequestCustomer(
          requestRows[0],
          `Actualización de tu solicitud #${id} - JR Electricidad`,
          `El estado de tu solicitud cambió a: ${status.replace(/_/g, " ")}.`
        );
        await notifyRequestWhatsApp(
          requestRows[0],
          `JR Electricidad: tu solicitud #${id} cambió a ${status.replace(/_/g, " ")}.`
        );
      }
    }

    res.json({ success: true, message: "Solicitud actualizada correctamente." });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error actualizando solicitud V2", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo actualizar la solicitud." });
  }
});

// Compatibilidad V1 para cambio de estado.
app.patch("/api/admin/quote-requests/:id(\\d+)/status", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    const statusMap = {
      pendiente: "nueva",
      contactado: "en_revision",
      presupuestado: "presupuestada",
      cerrado: "cerrada"
    };
    const incoming = String(req.body.status || "").trim();
    const status = statusMap[incoming] || incoming;

    if (!id || !validateRequestStatus(status)) {
      return res.status(400).json({ error: "Estado de solicitud inválido." });
    }

    const [currentRows] = await pool.query("SELECT status FROM quote_requests WHERE id=? LIMIT 1", [id]);
    if (!currentRows.length) return res.status(404).json({ error: "Solicitud no encontrada." });

    await pool.query("UPDATE quote_requests SET status=?, closed_at=? WHERE id=?",
      [status, status === "cerrada" ? new Date() : null, id]);

    await pool.query(
      `INSERT INTO quote_request_history
        (quote_request_id, actor_user_id, action, old_status, new_status)
       VALUES (?, ?, 'status_changed', ?, ?)`,
      [id, req.session.user.id, currentRows[0].status, status]
    );

    await writeAudit(req, "request_status_changed", "quote_request", id, {
      old_status: currentRows[0].status,
      new_status: status
    });

    await createAdminNotification({
      type: "quote_request_status",
      message: `La solicitud #${id} cambió al estado "${status}".`,
      entityType: "quote_request",
      entityId: id,
      linkUrl: "/admin.html#quoteRequestsSection",
      priority: "normal"
    }).catch(() => {});

    res.json({ success: true, message: "Estado de la solicitud actualizado.", status });
  } catch (error) {
    logError("Error actualizando estado de solicitud", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo actualizar el estado." });
  }
});

// Historial independiente.
app.get("/api/admin/quote-requests/:id(\\d+)/history", requireAdmin, async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID de solicitud inválido." });

    const [rows] = await pool.query(
      `SELECT h.id,h.action,h.old_status,h.new_status,h.metadata,h.created_at,u.name AS actor_name
       FROM quote_request_history h
       LEFT JOIN users u ON u.id=h.actor_user_id
       WHERE h.quote_request_id=?
       ORDER BY h.created_at DESC,h.id DESC`,
      [id]
    );
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo historial de solicitud", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo obtener el historial." });
  }
});

// Técnicos disponibles.
app.get("/api/admin/quote-requests/assignees", requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id,name,email,role FROM users ORDER BY name ASC"
    );
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo técnicos", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener los técnicos." });
  }
});

// Adjuntar imágenes/documentos.
const requestAttachmentsDir = path.join(uploadsDir, "requests");
if (!fs.existsSync(requestAttachmentsDir)) fs.mkdirSync(requestAttachmentsDir, { recursive: true });

const requestAttachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, requestAttachmentsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, Date.now() + "-" + crypto.randomBytes(10).toString("hex") + ext);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain"
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Tipo de archivo no permitido."));
    }
    cb(null, true);
  }
});

app.post("/api/admin/quote-requests/:id(\\d+)/attachments", requireAdmin, requestAttachmentUpload.single("file"), async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    if (!id) {
      if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    if (!req.file) return res.status(400).json({ error: "Seleccioná un archivo." });

    const [rows] = await pool.query("SELECT id FROM quote_requests WHERE id=? LIMIT 1", [id]);
    if (!rows.length) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const url = "/uploads/requests/" + req.file.filename;

    const [result] = await pool.query(
      `INSERT INTO quote_request_attachments
        (quote_request_id, uploaded_by_user_id, original_name, stored_name, url, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.session.user.id,
        String(req.file.originalname || "").slice(0, 255),
        req.file.filename,
        url,
        req.file.mimetype,
        Number(req.file.size || 0)
      ]
    );

    await recordRequestHistory(req, id, "attachment_added", null, null, {
      attachment_id: result.insertId,
      original_name: req.file.originalname
    });

    await writeAudit(req, "request_attachment_added", "quote_request", id, {
      attachment_id: result.insertId,
      original_name: req.file.originalname
    });

    res.status(201).json({
      success: true,
      attachment: {
        id: result.insertId,
        original_name: req.file.originalname,
        url,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size
      }
    });
  } catch (error) {
    if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
    logError("Error adjuntando archivo a solicitud", { requestId: req.requestId, error: error.message });
    res.status(400).json({ error: error.message || "No se pudo adjuntar el archivo." });
  }
});

app.delete("/api/admin/quote-requests/:id(\\d+)/attachments/:attachmentId(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    const attachmentId = validateRequestId(req.params.attachmentId);
    if (!id || !attachmentId) return res.status(400).json({ error: "ID de solicitud o archivo inválido." });

    const [rows] = await pool.query(
      "SELECT * FROM quote_request_attachments WHERE id=? AND quote_request_id=? LIMIT 1",
      [attachmentId, id]
    );
    if (!rows.length) return res.status(404).json({ error: "Archivo no encontrado." });

    const filePath = path.join(requestAttachmentsDir, rows[0].stored_name);
    await fs.promises.unlink(filePath).catch(() => {});
    await pool.query("DELETE FROM quote_request_attachments WHERE id=?", [attachmentId]);

    await recordRequestHistory(req, id, "attachment_deleted", null, null, {
      attachment_id: attachmentId,
      original_name: rows[0].original_name
    });

    await writeAudit(req, "request_attachment_deleted", "quote_request", id, {
      attachment_id: attachmentId
    });

    res.json({ success: true, message: "Archivo eliminado." });
  } catch (error) {
    logError("Error eliminando archivo de solicitud", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo eliminar el archivo." });
  }
});

// Convertir solicitud a presupuesto borrador.
app.post("/api/admin/quote-requests/:id(\\d+)/convert-to-quote", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = validateRequestId(req.params.id);
    if (!id) {
      connection.release();
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    await connection.beginTransaction();

    const [requestRows] = await connection.query(
      "SELECT * FROM quote_requests WHERE id=? LIMIT 1 FOR UPDATE",
      [id]
    );
    if (!requestRows.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const request = requestRows[0];

    const [existingQuotes] = await connection.query(
      "SELECT id,quote_number,status FROM quotes WHERE quote_request_id=? ORDER BY id DESC LIMIT 1",
      [id]
    );

    if (existingQuotes.length) {
      await connection.commit();
      connection.release();
      return res.json({
        success: true,
        already_exists: true,
        quote_id: existingQuotes[0].id,
        quote_number: existingQuotes[0].quote_number,
        status: existingQuotes[0].status
      });
    }

    const quoteNumber = await nextDocumentNumber(connection, "quote");
    const accessToken = crypto.randomBytes(24).toString("hex");

    const [quoteResult] = await connection.query(
      `INSERT INTO quotes
        (quote_request_id, quote_number, access_token, issue_date, expiration_date, notes, status, subtotal, discount, total)
       VALUES (?, ?, ?, CURDATE(), NULL, ?, 'borrador', 0, 0, 0)`,
      [id, quoteNumber, accessToken, request.internal_notes || request.description || ""]
    );

    await connection.query(
      `INSERT INTO quote_items
        (quote_id, description, quantity, unit, unit_price, total)
       VALUES (?, ?, 1, 'global', 0, 0)`,
      [quoteResult.insertId, request.service || request.description || "Trabajo solicitado"]
    );

    const newStatus = request.status === "nueva" || request.status === "en_revision" || request.status === "presupuestando"
      ? "presupuestada"
      : request.status;

    await connection.query(
      "UPDATE quote_requests SET status=? WHERE id=?",
      [newStatus, id]
    );

    await connection.query(
      `INSERT INTO quote_request_history
        (quote_request_id, actor_user_id, action, old_status, new_status, metadata)
       VALUES (?, ?, 'converted_to_quote', ?, ?, ?)`,
      [id, req.session.user.id, request.status, newStatus, JSON.stringify({ quote_id: quoteResult.insertId })]
    );

    await connection.commit();
    connection.release();

    await writeAudit(req, "request_converted_to_quote", "quote_request", id, {
      quote_id: quoteResult.insertId
    });

    res.status(201).json({
      success: true,
      quote_id: quoteResult.insertId,
      quote_number: quoteNumber,
      status: "borrador"
    });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error convirtiendo solicitud a presupuesto", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo convertir la solicitud en presupuesto." });
  }
});

// Convertir solicitud a trabajo. Si no existe presupuesto, crea uno borrador primero.
app.post("/api/admin/quote-requests/:id(\\d+)/convert-to-job", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = validateRequestId(req.params.id);
    if (!id) {
      connection.release();
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    await connection.beginTransaction();

    const [requestRows] = await connection.query(
      "SELECT * FROM quote_requests WHERE id=? LIMIT 1 FOR UPDATE",
      [id]
    );
    if (!requestRows.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const request = requestRows[0];

    const [quoteRows] = await connection.query(
      "SELECT id,quote_number FROM quotes WHERE quote_request_id=? ORDER BY id DESC LIMIT 1",
      [id]
    );

    let quoteId;
    let quoteNumber;

    if (quoteRows.length) {
      quoteId = quoteRows[0].id;
      quoteNumber = quoteRows[0].quote_number;
    } else {
      quoteNumber = await nextDocumentNumber(connection, "quote");
      const accessToken = crypto.randomBytes(24).toString("hex");

      const [quoteResult] = await connection.query(
        `INSERT INTO quotes
          (quote_request_id, quote_number, access_token, issue_date, expiration_date, notes, status, subtotal, discount, total)
         VALUES (?, ?, ?, CURDATE(), NULL, ?, 'borrador', 0, 0, 0)`,
        [id, quoteNumber, accessToken, request.internal_notes || request.description || ""]
      );

      quoteId = quoteResult.insertId;

      await connection.query(
        `INSERT INTO quote_items
          (quote_id, description, quantity, unit, unit_price, total)
         VALUES (?, ?, 1, 'global', 0, 0)`,
        [quoteId, request.service || request.description || "Trabajo solicitado"]
      );
    }

    const [jobRows] = await connection.query(
      "SELECT id,status FROM jobs WHERE quote_id=? LIMIT 1",
      [quoteId]
    );

    if (jobRows.length) {
      await connection.commit();
      connection.release();
      return res.json({
        success: true,
        already_exists: true,
        job_id: jobRows[0].id,
        quote_id: quoteId,
        quote_number: quoteNumber,
        status: jobRows[0].status
      });
    }

    const jobNumber = await nextDocumentNumber(connection, "job");
    const [jobResult] = await connection.query(
      "INSERT INTO jobs (quote_id,job_number,status) VALUES (?, ?, 'pendiente_presupuesto')",
      [quoteId, jobNumber]
    );

    await connection.query(
      `INSERT INTO quote_request_history
        (quote_request_id, actor_user_id, action, old_status, new_status, metadata)
       VALUES (?, ?, 'converted_to_job', ?, 'programada', ?)`,
      [id, req.session.user.id, request.status, JSON.stringify({ quote_id: quoteId, job_id: jobResult.insertId })]
    );

    await connection.query(
      "UPDATE quote_requests SET status='programada' WHERE id=?",
      [id]
    );

    await connection.commit();
    connection.release();

    await writeAudit(req, "request_converted_to_job", "quote_request", id, {
      quote_id: quoteId,
      job_id: jobResult.insertId
    });

    res.status(201).json({
      success: true,
      job_id: jobResult.insertId,
      quote_id: quoteId,
      quote_number: quoteNumber,
      status: "programada"
    });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error convirtiendo solicitud a trabajo", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo convertir la solicitud en trabajo." });
  }
});

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
    const token = String(req.params.token || "").trim();
    if (!/^[A-Za-z0-9_-]{24,200}$/.test(token)) {
      return res.status(404).json({ error: "Presupuesto no encontrado o enlace inválido." });
    }

    const [rows] = await pool.query(
      `SELECT
        q.id, q.quote_number, q.issue_date, q.expiration_date, q.notes,
        q.status, q.subtotal, q.discount, q.total, q.viewed_at,
        qr.name AS client_name, qr.email AS client_email, qr.phone AS client_phone,
        qr.service AS requested_service,
        qi.id AS item_id, qi.description, qi.quantity, qi.unit, qi.unit_price,
        qi.total AS item_total,
        qa.id AS acceptance_id, qa.decision AS acceptance_decision,
        qa.customer_name AS acceptance_customer_name,
        qa.customer_email AS acceptance_customer_email,
        qa.customer_phone AS acceptance_customer_phone,
        qa.customer_note AS acceptance_note,
        qa.consent_text AS acceptance_consent_text,
        qa.signature_name AS acceptance_signature_name,
        qa.ip_address AS acceptance_ip,
        qa.user_agent AS acceptance_user_agent,
        qa.created_at AS acceptance_created_at
      FROM quotes q
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN quote_items qi ON qi.quote_id=q.id
      LEFT JOIN (
        SELECT qa1.*
        FROM quote_acceptances qa1
        INNER JOIN (
          SELECT quote_id, MAX(id) AS max_id
          FROM quote_acceptances
          GROUP BY quote_id
        ) latest ON latest.max_id=qa1.id
      ) qa ON qa.quote_id=q.id
      WHERE q.access_token=?
      ORDER BY qi.id ASC`,
      [token]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Presupuesto no encontrado o enlace inválido." });
    }

    await pool.query(
      "UPDATE quotes SET viewed_at=COALESCE(viewed_at,NOW()) WHERE id=?",
      [rows[0].id]
    ).catch(() => {});

    const row = rows[0];
    const quote = {
      id: row.id,
      quote_number: row.quote_number,
      issue_date: row.issue_date,
      expiration_date: row.expiration_date,
      notes: row.notes,
      status: row.status,
      viewed_at: row.viewed_at,
      subtotal: row.subtotal,
      discount: row.discount,
      total: row.total,
      client_name: row.client_name,
      client_email: row.client_email,
      client_phone: row.client_phone,
      requested_service: row.requested_service,
      items: [],
      acceptance: row.acceptance_id ? {
        id: row.acceptance_id,
        decision: row.acceptance_decision,
        customer_name: row.acceptance_customer_name,
        customer_email: row.acceptance_customer_email,
        customer_phone: row.acceptance_customer_phone,
        note: row.acceptance_note,
        consent_text: row.acceptance_consent_text,
        signature_name: row.acceptance_signature_name,
        ip_address: row.acceptance_ip,
        user_agent: row.acceptance_user_agent,
        created_at: row.acceptance_created_at
      } : null
    };

    for (const item of rows) {
      if (item.item_id) {
        quote.items.push({
          id: item.item_id,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price,
          total: item.item_total
        });
      }
    }

    res.json(quote);
  } catch (error) {
    logError("Error obteniendo presupuesto público", { requestId:req.requestId, error:error.message });
    res.status(500).json({ error:"No se pudo obtener el presupuesto." });
  }
});
// ========================================
// PRESUPUESTOS - ADMIN
// ========================================

// =========================================================
// PRESUPUESTOS V2 — ADMIN
// =========================================================

const QUOTE_STATUSES = [
  "borrador",
  "enviado",
  "aceptado",
  "rechazado",
  "vencido",
  "cerrado"
];

function validateQuoteId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateQuoteStatus(value) {
  return QUOTE_STATUSES.includes(String(value || "").trim());
}

function validateQuoteDate(value) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  return text;
}

async function recordQuoteHistory(req, quoteId, action, oldStatus, newStatus, metadata = null, db = pool) {
  await db.query(
    `INSERT INTO quote_history
      (quote_id, actor_user_id, action, old_status, new_status, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      quoteId,
      req.session?.user?.id || null,
      action,
      oldStatus || null,
      newStatus || null,
      metadata ? JSON.stringify(metadata) : null
    ]
  );
}

async function notifyQuoteWhatsApp(quote) {
  try {
    const settings=await whatsappBusinessEnabled();
    if(!settings?.whatsapp_auto_notifications || !quote?.phone) return false;
    await queueWhatsApp({
      to:quote.phone,
      message:`JR Electricidad: tu presupuesto ${quote.quote_number} ya está disponible. Podés consultarlo en: ${(process.env.APP_URL || "")}/presupuesto/${encodeURIComponent(quote.access_token)}`,
      entityType:"quote",
      entityId:quote.id
    });
    return true;
  } catch(error) {
    logError("No se pudo encolar WhatsApp del presupuesto",{requestId:null,error:error.message,quoteId:quote?.id});
    return false;
  }
}

async function sendQuoteEmail(quote) {
  if (!quote?.email) return false;
  try {
    await queueEmail({
      to: quote.email,
      subject: "Presupuesto " + quote.quote_number + " - JR Electricidad",
      template: "quote_sent",
      data: {
        name: quote.name || quote.client_name || "",
        quoteNumber: quote.quote_number,
        total: quoteMoney(quote.total),
        link: (process.env.APP_URL || "") + "/presupuesto/" + encodeURIComponent(quote.access_token)
      }
    });
    return true;
  } catch (error) {
    logError("No se pudo encolar el presupuesto por email", {
      requestId: null,
      quoteId: quote.id,
      error: error.message
    });
    return false;
  }
}

// PDF del presupuesto.
app.get("/api/admin/quotes/:id(\\d+)/pdf", requireAdmin, async (req, res) => {
  try {
    const id = validateQuoteId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID de presupuesto inválido." });

    const quote = await getQuoteDetail(pool, id);
    if (!quote) return res.status(404).json({ error: "Presupuesto no encontrado." });

    const doc = buildQuotePdf(quote);
    const pdf = await pdfToBuffer(doc);
    const filename = quote.pdf_filename || `presupuesto-${quote.quote_number || id}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${String(filename).replace(/[^a-zA-Z0-9._-]/g, "_")}"`
    );
    res.setHeader("Content-Length", pdf.length);
    res.send(pdf);
  } catch (error) {
    logError("Error generando PDF del presupuesto", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo generar el PDF del presupuesto." });
  }
});

// Listado con búsqueda y filtros.
app.get("/api/admin/quotes", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    if (status && !validateQuoteStatus(status)) {
      return res.status(400).json({ error: "Estado de presupuesto inválido." });
    }

    const params = [];
    let sql = `
      SELECT
        q.id,q.quote_number,q.access_token,q.issue_date,q.expiration_date,
        q.subtotal,q.discount,q.total,q.status,q.sent_at,q.accepted_at,
        q.rejected_at,q.created_at,q.updated_at,
        qr.id AS quote_request_id,qr.name AS client_name,qr.email AS client_email,
        qr.phone AS client_phone,qr.service AS requested_service,
        COUNT(qi.id) AS items_count,
        j.id AS job_id,j.status AS job_status
      FROM quotes q
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN quote_items qi ON qi.quote_id=q.id
      LEFT JOIN jobs j ON j.quote_id=q.id
      WHERE 1=1
    `;

    if (search) {
      const v = `%${search}%`;
      sql += " AND (q.quote_number LIKE ? OR qr.name LIKE ? OR qr.email LIKE ? OR qr.phone LIKE ? OR qr.service LIKE ?)";
      params.push(v,v,v,v,v);
    }
    if (status) {
      sql += " AND q.status=?";
      params.push(status);
    }
    if (dateFrom) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) return res.status(400).json({ error: "Fecha desde inválida." });
      sql += " AND DATE(q.created_at)>=?";
      params.push(dateFrom);
    }
    if (dateTo) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) return res.status(400).json({ error: "Fecha hasta inválida." });
      sql += " AND DATE(q.created_at)<=?";
      params.push(dateTo);
    }

    sql += `
      GROUP BY q.id,q.quote_number,q.access_token,q.issue_date,q.expiration_date,
        q.subtotal,q.discount,q.total,q.status,q.sent_at,q.accepted_at,q.rejected_at,
        q.created_at,q.updated_at,qr.id,qr.name,qr.email,qr.phone,qr.service,j.id,j.status
      ORDER BY q.created_at DESC,q.id DESC
    `;

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo presupuestos", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener los presupuestos." });
  }
});

// Detalle completo.
app.get("/api/admin/quotes/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = validateQuoteId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID de presupuesto inválido." });

    const quote = await getQuoteDetail(pool, id);
    if (!quote) return res.status(404).json({ error: "Presupuesto no encontrado." });

    const [history] = await pool.query(
      `SELECT h.*,u.name AS actor_name
       FROM quote_history h
       LEFT JOIN users u ON u.id=h.actor_user_id
       WHERE h.quote_id=?
       ORDER BY h.created_at DESC,h.id DESC`,
      [id]
    );

    const [jobs] = await pool.query(
      "SELECT id,status,started_at,completed_at,created_at,updated_at FROM jobs WHERE quote_id=? ORDER BY id DESC",
      [id]
    );

    res.json({ ...quote, history, jobs });
  } catch (error) {
    logError("Error obteniendo detalle de presupuesto", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo obtener el presupuesto." });
  }
});

// Crear presupuesto.
app.post("/api/admin/quotes", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const body = req.body || {};
    const requestId = validateRequestId(body.quote_request_id);
    if (!requestId) {
      connection.release();
      return res.status(400).json({ error: "La solicitud asociada es obligatoria." });
    }

    const issueDate = validateQuoteDate(body.issue_date);
    const expirationDate = validateQuoteDate(body.expiration_date);
    if (issueDate === undefined || expirationDate === undefined) {
      connection.release();
      return res.status(400).json({ error: "Las fechas del presupuesto no son válidas." });
    }

    const discount = Number(body.discount || 0);
    if (!Number.isFinite(discount) || discount < 0 || discount > 1000000000) {
      connection.release();
      return res.status(400).json({ error: "El descuento no es válido." });
    }

    const items = cleanQuoteItems(body.items);
    const subtotal = items.reduce((sum,item) => sum + item.total, 0);
    if (discount > subtotal) {
      connection.release();
      return res.status(400).json({ error: "El descuento no puede superar el subtotal." });
    }
    const total = subtotal - discount;
    const notes = String(body.notes || "").trim();
    if (notes.length > 5000) {
      connection.release();
      return res.status(400).json({ error: "Las notas no pueden superar 5000 caracteres." });
    }

    await connection.beginTransaction();

    const [requestRows] = await connection.query(
      "SELECT * FROM quote_requests WHERE id=? LIMIT 1 FOR UPDATE",
      [requestId]
    );
    if (!requestRows.length) {
      await connection.rollback(); connection.release();
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const quoteNumber = `PR-${new Date().toISOString().replace(/\D/g,"").slice(0,14)}-${requestId}`;
    const accessToken = crypto.randomBytes(32).toString("hex");

    const [result] = await connection.query(
      `INSERT INTO quotes
       (quote_request_id,quote_number,access_token,issue_date,expiration_date,notes,status,subtotal,discount,total)
       VALUES (?,?,?,?,?,?,'borrador',?,?,?)`,
      [requestId,quoteNumber,accessToken,issueDate || new Date().toISOString().slice(0,10),expirationDate,notes,subtotal,discount,total]
    );

    for (const item of items) {
      await connection.query(
        `INSERT INTO quote_items (quote_id,description,quantity,unit,unit_price,total)
         VALUES (?,?,?,?,?,?)`,
        [result.insertId,item.description,item.quantity,item.unit,item.unit_price,item.total]
      );
    }

    await connection.query(
      `INSERT INTO quote_history (quote_id,actor_user_id,action,new_status,metadata)
       VALUES (?,?,'quote_created','borrador',?)`,
      [result.insertId,req.session.user.id,JSON.stringify({ quote_request_id: requestId, items: items.length })]
    );

    await connection.commit();
    connection.release();

    await writeAudit(req,"quote_created","quote",result.insertId,{quote_request_id:requestId,total});

    res.status(201).json({
      success:true,
      id:result.insertId,
      quote_id:result.insertId,
      quote_number:quoteNumber,
      total
    });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error creando presupuesto", { requestId:req.requestId, error:error.message });
    res.status(500).json({ error:"No se pudo crear el presupuesto." });
  }
});

// Actualizar presupuesto.
app.put("/api/admin/quotes/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = validateQuoteId(req.params.id);
    if (!id) { connection.release(); return res.status(400).json({error:"ID de presupuesto inválido."}); }

    const body = req.body || {};
    const issueDate = validateQuoteDate(body.issue_date);
    const expirationDate = validateQuoteDate(body.expiration_date);
    if (issueDate === undefined || expirationDate === undefined) {
      connection.release(); return res.status(400).json({error:"Las fechas del presupuesto no son válidas."});
    }

    const discount = Number(body.discount || 0);
    if (!Number.isFinite(discount) || discount < 0 || discount > 1000000000) {
      connection.release(); return res.status(400).json({error:"El descuento no es válido."});
    }

    const items = cleanQuoteItems(body.items);
    const subtotal = items.reduce((sum,item)=>sum+item.total,0);
    if (discount > subtotal) {
      connection.release(); return res.status(400).json({error:"El descuento no puede superar el subtotal."});
    }
    const total = subtotal-discount;
    const notes = String(body.notes || "").trim();
    if (notes.length > 5000) {
      connection.release(); return res.status(400).json({error:"Las notas no pueden superar 5000 caracteres."});
    }

    await connection.beginTransaction();

    const [rows] = await connection.query("SELECT * FROM quotes WHERE id=? LIMIT 1 FOR UPDATE",[id]);
    if (!rows.length) {
      await connection.rollback(); connection.release();
      return res.status(404).json({error:"Presupuesto no encontrado."});
    }

    const current = rows[0];
    if (["aceptado","cerrado"].includes(current.status)) {
      await connection.rollback(); connection.release();
      return res.status(409).json({error:"No se puede modificar un presupuesto aceptado o cerrado."});
    }

    await connection.query(
      `UPDATE quotes
       SET issue_date=?,expiration_date=?,notes=?,subtotal=?,discount=?,total=?
       WHERE id=?`,
      [issueDate || current.issue_date,expirationDate,notes,subtotal,discount,total,id]
    );

    await connection.query("DELETE FROM quote_items WHERE quote_id=?",[id]);
    for (const item of items) {
      await connection.query(
        `INSERT INTO quote_items (quote_id,description,quantity,unit,unit_price,total)
         VALUES (?,?,?,?,?,?)`,
        [id,item.description,item.quantity,item.unit,item.unit_price,item.total]
      );
    }

    await connection.query(
      `INSERT INTO quote_history (quote_id,actor_user_id,action,old_status,new_status,metadata)
       VALUES (?,?,'quote_updated',?,?,?)`,
      [id,req.session.user.id,current.status,current.status,JSON.stringify({subtotal,discount,total,items:items.length})]
    );

    await connection.commit();
    connection.release();

    await writeAudit(req,"quote_updated","quote",id,{subtotal,discount,total});

    res.json({success:true,message:"Presupuesto actualizado correctamente.",total});
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error actualizando presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el presupuesto."});
  }
});

// Cambiar estado y enviar al cliente.
app.patch("/api/admin/quotes/:id(\\d+)/status", requireAdmin, adminMutationLimiter, async (req,res)=>{
  const id=validateQuoteId(req.params.id);
  const status=String(req.body?.status||"").trim();

  if(!id || !validateQuoteStatus(status)) {
    return res.status(400).json({error:"Estado de presupuesto inválido."});
  }

  try {
    const [rows]=await pool.query(
      `SELECT q.*,qr.name,qr.email
       FROM quotes q INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE q.id=? LIMIT 1`,[id]
    );
    if(!rows.length) return res.status(404).json({error:"Presupuesto no encontrado."});
    const current=rows[0];

    if(["aceptado","cerrado"].includes(current.status) && current.status!==status) {
      return res.status(409).json({error:"El presupuesto ya está cerrado para cambios."});
    }

    const allowedTransitions={
      borrador:["borrador","enviado","cerrado"],
      enviado:["enviado","aceptado","rechazado","vencido","cerrado"],
      aceptado:["aceptado","cerrado"],
      rechazado:["rechazado","borrador","cerrado"],
      vencido:["vencido","borrador","cerrado"],
      cerrado:["cerrado"]
    };

    if(!allowedTransitions[current.status]?.includes(status)) {
      return res.status(409).json({error:`No se puede pasar de "${current.status}" a "${status}".`});
    }

    const sentAt=status==="enviado" ? new Date() : current.sent_at;
    const acceptedAt=status==="aceptado" ? new Date() : current.accepted_at;
    const rejectedAt=status==="rechazado" ? new Date() : current.rejected_at;

    await pool.query(
      `UPDATE quotes SET status=?,sent_at=?,accepted_at=?,rejected_at=? WHERE id=?`,
      [status,sentAt,acceptedAt,rejectedAt,id]
    );

    await recordQuoteHistory(req,id,"quote_status_changed",current.status,status,{});

    await writeAudit(req,"quote_status_changed","quote",id,{old_status:current.status,new_status:status});

    if(status==="enviado") {
      const sent=await sendQuoteEmail({...current,status,total:current.total});
      await notifyQuoteWhatsApp({...current,status,total:current.total});
      await createAdminNotification({
        type: "quote_sent",
        quoteId: id,
        entityType: "quote",
        entityId: id,
        message: `El presupuesto ${current.quote_number} fue marcado como enviado.`,
        linkUrl: "/admin.html#quotesSection",
        priority: "normal"
      }).catch(() => {});
      res.json({success:true,status,email_sent:sent,message:sent?"Presupuesto enviado al cliente.":"Presupuesto marcado como enviado; email no disponible o no configurado."});
      return;
    }

    if(status==="aceptado") {
      await pool.query(
        "UPDATE quote_requests SET status='aceptada' WHERE id=? AND status NOT IN ('cerrada','finalizada')",
        [current.quote_request_id]
      );
    }

    res.json({success:true,status});
  } catch(error) {
    logError("Error cambiando estado del presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo cambiar el estado del presupuesto."});
  }
});

// Eliminar solamente borradores.
app.delete("/api/admin/quotes/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req,res)=>{
  try {
    const id=validateQuoteId(req.params.id);
    if(!id) return res.status(400).json({error:"ID de presupuesto inválido."});

    const [rows]=await pool.query("SELECT status,quote_number FROM quotes WHERE id=? LIMIT 1",[id]);
    if(!rows.length) return res.status(404).json({error:"Presupuesto no encontrado."});
    if(rows[0].status!=="borrador") return res.status(409).json({error:"Solo se pueden eliminar presupuestos en borrador."});

    await pool.query("DELETE FROM quotes WHERE id=?",[id]);
    await writeAudit(req,"quote_deleted","quote",id,{quote_number:rows[0].quote_number});
    res.json({success:true,message:"Presupuesto eliminado."});
  } catch(error) {
    logError("Error eliminando presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo eliminar el presupuesto."});
  }
});

// Historial del presupuesto.
app.get("/api/admin/quotes/:id(\\d+)/history", requireAdmin, async (req,res)=>{
  try {
    const id=validateQuoteId(req.params.id);
    if(!id) return res.status(400).json({error:"ID de presupuesto inválido."});
    const [rows]=await pool.query(
      `SELECT h.*,u.name AS actor_name
       FROM quote_history h LEFT JOIN users u ON u.id=h.actor_user_id
       WHERE h.quote_id=? ORDER BY h.created_at DESC,h.id DESC`,[id]
    );
    res.json(rows);
  } catch(error) {
    logError("Error obteniendo historial de presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el historial del presupuesto."});
  }
});

// =====================================================
// NOTIFICACIONES DEL ADMINISTRADOR — V2
// =====================================================

app.get("/api/admin/notifications", requireAdmin, async (req,res) => {
  try {
    const limitRaw = Number(req.query.limit || 50);
    const limit = Math.min(Math.max(Number.isInteger(limitRaw) ? limitRaw : 50, 1), 100);
    const includeArchived = String(req.query.archived || "") === "1";
    const recipient = Number(req.session.user.id);

    const [rows] = await pool.query(
      `SELECT id,user_id,type,quote_id,entity_type,entity_id,message,link_url,priority,
              is_read,read_at,archived_at,created_at
       FROM admin_notifications
       WHERE (user_id IS NULL OR user_id=?)
         AND (?=1 OR archived_at IS NULL)
       ORDER BY is_read ASC, created_at DESC, id DESC
       LIMIT ${limit}`,
      [recipient, includeArchived ? 1 : 0]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS unread
       FROM admin_notifications
       WHERE (user_id IS NULL OR user_id=?)
         AND is_read=0
         AND archived_at IS NULL`,
      [recipient]
    );

    res.json({
      success:true,
      notifications:rows,
      unread:Number(countRows[0]?.unread || 0)
    });
  } catch(error) {
    logError("Error obteniendo notificaciones",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron obtener las notificaciones."});
  }
});

app.post("/api/admin/notifications/:id/read", requireAdmin, async (req,res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de notificación inválido."});
    const [result]=await pool.query(
      `UPDATE admin_notifications
       SET is_read=1,read_at=COALESCE(read_at,NOW())
       WHERE id=? AND (user_id IS NULL OR user_id=?) AND archived_at IS NULL`,
      [id,Number(req.session.user.id)]
    );
    if(!result.affectedRows) return res.status(404).json({error:"Notificación no encontrada."});
    res.json({success:true,message:"Notificación marcada como leída."});
  } catch(error) {
    logError("Error marcando notificación",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar la notificación."});
  }
});

app.post("/api/admin/notifications/read-all", requireAdmin, async (req,res) => {
  try {
    await pool.query(
      `UPDATE admin_notifications
       SET is_read=1,read_at=COALESCE(read_at,NOW())
       WHERE (user_id IS NULL OR user_id=?)
         AND is_read=0 AND archived_at IS NULL`,
      [Number(req.session.user.id)]
    );
    res.json({success:true,message:"Todas las notificaciones fueron marcadas como leídas."});
  } catch(error) {
    logError("Error marcando notificaciones",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron marcar las notificaciones como leídas."});
  }
});

app.post("/api/admin/notifications/:id/archive", requireAdmin, async (req,res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de notificación inválido."});
    const [result]=await pool.query(
      `UPDATE admin_notifications
       SET archived_at=NOW(),is_read=1,read_at=COALESCE(read_at,NOW())
       WHERE id=? AND (user_id IS NULL OR user_id=?) AND archived_at IS NULL`,
      [id,Number(req.session.user.id)]
    );
    if(!result.affectedRows) return res.status(404).json({error:"Notificación no encontrada."});
    res.json({success:true,message:"Notificación archivada."});
  } catch(error) {
    logError("Error archivando notificación",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo archivar la notificación."});
  }
});

app.post("/api/admin/notifications/archive-all", requireAdmin, async (req,res) => {
  try {
    await pool.query(
      `UPDATE admin_notifications
       SET archived_at=NOW(),is_read=1,read_at=COALESCE(read_at,NOW())
       WHERE (user_id IS NULL OR user_id=?) AND archived_at IS NULL`,
      [Number(req.session.user.id)]
    );
    res.json({success:true,message:"Todas las notificaciones fueron archivadas."});
  } catch(error) {
    logError("Error archivando notificaciones",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron archivar las notificaciones."});
  }
});

// =========================================================
// V2 — EMAIL / ESTADO DE ENTREGA
// =========================================================

app.get("/api/admin/email/status", requireAdmin, async (req,res) => {
  try {
    const [rows] = await pool.query(
      `SELECT status,COUNT(*) AS total,MAX(created_at) AS last_created,MAX(sent_at) AS last_sent
       FROM email_outbox GROUP BY status ORDER BY status`
    );
    res.json({
      success:true,
      smtp_configured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.MAIL_FROM),
      statuses: rows
    });
  } catch(error) {
    logError("Error obteniendo estado de email",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el estado del email."});
  }
});

app.get("/api/admin/email/outbox", requireAdmin, async (req,res) => {
  try {
    const limit=Math.min(Math.max(Number(req.query.limit)||50,1),100);
    const status=String(req.query.status||"").trim();
    const params=[];
    let sql=`SELECT id,to_email,subject,template,status,attempts,max_attempts,next_attempt_at,sent_at,last_error,provider_message_id,request_id,created_at,updated_at
              FROM email_outbox WHERE 1=1`;
    if(status){
      const allowed=["queued","sending","sent","failed","skipped"];
      if(!allowed.includes(status)) return res.status(400).json({error:"Estado de email inválido."});
      sql+=" AND status=?";
      params.push(status);
    }
    sql+=" ORDER BY id DESC LIMIT "+limit;
    const [rows]=await pool.query(sql,params);
    res.json({success:true,emails:rows});
  } catch(error) {
    logError("Error obteniendo cola de email",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener la cola de email."});
  }
});

// =========================================================
// V2 — WHATSAPP
// =========================================================

async function whatsappBusinessEnabled() {
  const [rows] = await pool.query(
    "SELECT whatsapp,whatsapp_enabled,whatsapp_auto_notifications FROM business_settings WHERE id=1 LIMIT 1"
  );
  return rows[0] || null;
}

app.get("/api/admin/whatsapp/status", requireAdmin, async (req,res) => {
  try {
    const settings=await whatsappBusinessEnabled();
    const [rows]=await pool.query(
      "SELECT status,COUNT(*) AS total,MAX(created_at) AS last_created,MAX(sent_at) AS last_sent FROM whatsapp_outbox GROUP BY status"
    );
    res.json({
      success:true,
      provider_configured: whatsappProviderConfigured(),
      settings: settings || null,
      statuses: rows
    });
  } catch(error) {
    logError("Error obteniendo estado de WhatsApp",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el estado de WhatsApp."});
  }
});

app.get("/api/admin/whatsapp/outbox", requireAdmin, async (req,res) => {
  try {
    const limit=Math.min(Math.max(Number(req.query.limit)||50,1),100);
    const status=String(req.query.status||"").trim();
    const params=[];
    let sql=`SELECT id,to_phone,message,status,attempts,max_attempts,next_attempt_at,sent_at,last_error,provider_message_id,entity_type,entity_id,request_id,created_at,updated_at
              FROM whatsapp_outbox WHERE 1=1`;
    if(status){
      const allowed=["queued","sending","sent","failed","skipped"];
      if(!allowed.includes(status)) return res.status(400).json({error:"Estado de WhatsApp inválido."});
      sql+=" AND status=?";
      params.push(status);
    }
    sql+=" ORDER BY id DESC LIMIT "+limit;
    const [rows]=await pool.query(sql,params);
    res.json({success:true,messages:rows});
  } catch(error) {
    logError("Error obteniendo outbox de WhatsApp",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener la cola de WhatsApp."});
  }
});

app.post("/api/admin/whatsapp/send", requireAdmin, adminMutationLimiter, async (req,res) => {
  try {
    const phone=String(req.body.phone||"").trim();
    const message=String(req.body.message||"").trim();
    if(!phone || !message) return res.status(400).json({error:"Teléfono y mensaje son obligatorios."});
    const result=await queueWhatsApp({
      to:phone,
      message,
      requestId:req.requestId,
      entityType:String(req.body.entity_type||"manual").slice(0,50),
      entityId:req.body.entity_id ? Number(req.body.entity_id) : null
    });
    await writeAudit(req,"whatsapp_queued","whatsapp",result.id,{phone:result.phone});
    res.json({success:true,...result});
  } catch(error) {
    logError("Error encolando WhatsApp manual",{requestId:req.requestId,error:error.message});
    res.status(400).json({error:error.message});
  }
});

app.post("/api/admin/whatsapp/link", requireAdmin, async (req,res) => {
  try {
    const phone=String(req.body.phone||"").trim();
    const message=String(req.body.message||"").trim();
    const link=buildWhatsAppLink(phone,message);
    if(!link) return res.status(400).json({error:"Número de WhatsApp inválido."});
    res.json({success:true,link});
  } catch(error) {
    res.status(400).json({error:"No se pudo generar el enlace de WhatsApp."});
  }
});

// =========================================================
// V2 — ACEPTACIÓN DIGITAL DE PRESUPUESTOS
// =========================================================

const ACCEPTANCE_CONSENT_TEXT =
  "Declaro que revisé el presupuesto, sus conceptos, importes y condiciones, y autorizo a JR Electricidad a registrar digitalmente mi decisión.";

function validatePublicCustomer(body) {
  const name = String(body?.name || "").trim().replace(/\s+/g," ");
  const email = String(body?.email || "").trim().toLowerCase();
  const phone = String(body?.phone || "").trim();
  const note = String(body?.note || "").trim();
  const signatureName = String(body?.signatureName || "").trim().replace(/\s+/g," ");
  if(name.length<2||name.length>150) return {error:"Ingresá un nombre válido."};
  if(!validEmail(email)) return {error:"Ingresá un email válido."};
  if(phone.length<6||phone.length>50) return {error:"Ingresá un teléfono válido."};
  if(note.length>2000) return {error:"La observación no puede superar 2000 caracteres."};
  if(signatureName.length<2||signatureName.length>150) return {error:"Ingresá tu nombre como firma digital."};
  return {name,email,phone,note,signatureName};
}

function publicQuoteToken(req) {
  const token=String(req.params.token||"").trim();
  return /^[A-Za-z0-9_-]{24,200}$/.test(token) ? token : null;
}

async function sendAcceptanceEmail({to,quoteNumber,decision,customerName}) {
  if (!to) return false;
  try {
    await queueEmail({
      to,
      subject: (decision==="aceptado"?"Aceptación":"Rechazo") + " de presupuesto " + quoteNumber + " - JR Electricidad",
      template: "quote_decision",
      data: { customerName, quoteNumber, decision }
    });
    return true;
  } catch(error) {
    logError("No se pudo encolar confirmación de aceptación", {
      requestId:null,
      error:error.message,
      quoteNumber
    });
    return false;
  }
}

async function processPublicQuoteDecision(req,res,decision) {
  const token=publicQuoteToken(req);
  if(!token) return res.status(404).json({error:"Presupuesto no encontrado o enlace inválido."});
  const customer=validatePublicCustomer(req.body||{});
  if(customer.error) return res.status(400).json({error:customer.error});
  if(decision==="aceptado"&&req.body?.consent!==true) {
    return res.status(400).json({error:"Debés aceptar la constancia digital antes de confirmar."});
  }

  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]=await connection.query(
      `SELECT q.*,qr.name AS client_name,qr.email AS client_email,qr.phone AS client_phone
       FROM quotes q
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE q.access_token=? LIMIT 1 FOR UPDATE`,
      [token]
    );
    if(!rows.length) {
      await connection.rollback();
      return res.status(404).json({error:"Presupuesto no encontrado o enlace inválido."});
    }

    const quote=rows[0];
    if(["cerrado","vencido"].includes(quote.status) ||
       (quote.expiration_date && new Date(quote.expiration_date).getTime() < new Date().setHours(0,0,0,0))) {
      await connection.rollback();
      return res.status(409).json({error:"Este presupuesto está vencido o cerrado y ya no admite una decisión."});
    }
    if(quote.status===decision) {
      await connection.rollback();
      return res.json({success:true,status:decision,already_decided:true,message:`El presupuesto ya figura como ${decision}.`});
    }
    if(quote.status!=="enviado") {
      await connection.rollback();
      return res.status(409).json({error:"Este presupuesto no está disponible para una nueva decisión."});
    }

    const ip=req.ip||null;
    const userAgent=String(req.get("user-agent")||"").slice(0,512)||null;

    const [insertResult]=await connection.query(
      `INSERT INTO quote_acceptances
       (quote_id,decision,customer_name,customer_email,customer_phone,customer_note,consent_text,signature_name,ip_address,user_agent)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [quote.id,decision,customer.name,customer.email,customer.phone,customer.note||null,
       decision==="aceptado"?ACCEPTANCE_CONSENT_TEXT:null,customer.signatureName,ip,userAgent]
    );

    if(decision==="aceptado") {
      await connection.query(
        "UPDATE quotes SET status='aceptado',accepted_at=NOW() WHERE id=?",
        [quote.id]
      );
      await connection.query(
        "UPDATE quote_requests SET status='aceptada' WHERE id=? AND status NOT IN ('cerrada','finalizada')",
        [quote.quote_request_id]
      );
      await connection.query(
        `INSERT INTO jobs (quote_id,job_number,status) VALUES (?, ?, 'aceptado')
         ON DUPLICATE KEY UPDATE status='aceptado',updated_at=CURRENT_TIMESTAMP`,
        [quote.id, await nextDocumentNumber(connection, "job")]
      );
    } else {
      await connection.query(
        "UPDATE quotes SET status='rechazado',rejected_at=NOW() WHERE id=?",
        [quote.id]
      );
    }

    await connection.query(
      `INSERT INTO quote_history (quote_id,action,old_status,new_status,metadata)
       VALUES (?,'customer_decision','enviado',?,?)`,
      [quote.id,decision,JSON.stringify({
        source:"public",
        acceptance_id:insertResult.insertId,
        customer_name:customer.name,
        customer_email:customer.email,
        consent:decision==="aceptado"
      })]
    );

    await connection.query(
      "INSERT INTO admin_notifications (user_id,type,quote_id,entity_type,entity_id,message,link_url,priority,is_read,read_at,archived_at) VALUES (NULL,?,?,?,?,?,?,?,0,NULL,NULL)",
      [
        decision==="aceptado"?"quote_accepted":"quote_rejected",
        quote.id,
        "quote",
        quote.id,
        `El cliente ${quote.client_name} registró ${decision==="aceptado"?"la aceptación":"el rechazo"} del presupuesto ${quote.quote_number}.`,
        "/admin.html#quotesSection",
        "high"
      ]
    );

    await connection.commit();

    const emailSent=await sendAcceptanceEmail({
      to:customer.email,
      quoteNumber:quote.quote_number,
      decision,
      customerName:customer.name
    });

    await writeAudit(req,`quote_${decision}_public`,"quote",quote.id,{
      customer_name:customer.name,
      customer_email:customer.email,
      ip,
      user_agent:userAgent,
      email_sent:emailSent
    });

    res.json({
      success:true,
      status:decision,
      email_sent:emailSent,
      message:decision==="aceptado"
        ?"Presupuesto aceptado. Se registró tu aceptación y se creó el trabajo."
        :"Presupuesto rechazado. Se registró tu decisión correctamente."
    });
  } catch(error) {
    await connection.rollback().catch(()=>{});
    logError("Error procesando decisión pública del presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo registrar la decisión del presupuesto."});
  } finally {
    connection.release();
  }
}

app.post("/api/public/quotes/:token/accept",authLimiter,async(req,res)=>{
  return processPublicQuoteDecision(req,res,"aceptado");
});

app.post("/api/public/quotes/:token/reject",authLimiter,async(req,res)=>{
  return processPublicQuoteDecision(req,res,"rechazado");
});




// =========================================================
// FASE 14 — GESTIÓN CENTRALIZADA DE DOCUMENTOS
// =========================================================

function validateDocumentEntityId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function documentAbsolutePath(storedName) {
  const base = path.resolve(documentsDir);
  const target = path.resolve(base, String(storedName || ""));
  if (target !== base && !target.startsWith(base + path.sep)) {
    return null;
  }
  return target;
}

async function createStoredDocument({
  title,
  description = null,
  documentType,
  clientId = null,
  quoteRequestId = null,
  quoteId = null,
  jobId = null,
  originalName,
  mimeType,
  filePath,
  createdByUserId
}) {
  const type = normalizeDocumentType(documentType);
  if (!type) throw new Error("Tipo de documento inválido.");
  const stat = await fs.promises.stat(filePath);
  if (stat.size > MAX_DOCUMENT_SIZE) throw new Error("El documento supera los 10 MB.");
  const handle = await fs.promises.open(filePath, "r");
  const header = Buffer.alloc(16);
  try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }
  if (!validateDocumentSignature(header, mimeType)) {
    throw new Error("La firma del archivo no coincide con su tipo.");
  }

  const safeName = safeDocumentName(originalName);
  const storedName = path.basename(filePath);
  const sha256 = await sha256File(filePath);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [docResult] = await connection.query(
      `INSERT INTO documents
        (document_type,title,description,client_id,quote_request_id,quote_id,job_id,created_by_user_id,current_version)
       VALUES (?,?,?,?,?,?,?,?,1)`,
      [
        type,
        String(title || safeName).trim().slice(0,255) || safeName,
        description ? String(description).trim().slice(0,10000) : null,
        clientId, quoteRequestId, quoteId, jobId, createdByUserId || null
      ]
    );
    const documentId = Number(docResult.insertId);
    await connection.query(
      `INSERT INTO document_versions
        (document_id,version_number,original_name,stored_name,storage_path,mime_type,size_bytes,sha256,created_by_user_id)
       VALUES (?,1,?,?,?,?,?,?,?)`,
      [documentId, safeName, storedName, "documents/" + storedName, mimeType, stat.size, sha256, createdByUserId || null]
    );
    await connection.commit();
    return { documentId, version: 1, sha256, sizeBytes: stat.size };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function createDocumentVersion(documentId, file, userId) {
  const id = validateDocumentEntityId(documentId);
  if (!id) throw new Error("ID de documento inválido.");
  const stat = await fs.promises.stat(file.path);
  if (stat.size > MAX_DOCUMENT_SIZE) throw new Error("El documento supera los 10 MB.");
  const handle = await fs.promises.open(file.path, "r");
  const header = Buffer.alloc(16);
  try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }
  if (!validateDocumentSignature(header, file.mimetype)) throw new Error("La firma del archivo no coincide con su tipo.");

  const [docs] = await pool.query("SELECT id,current_version FROM documents WHERE id=? LIMIT 1", [id]);
  if (!docs.length) throw new Error("Documento no encontrado.");
  const version = Number(docs[0].current_version || 0) + 1;
  const sha256 = await sha256File(file.path);
  await pool.query(
    `INSERT INTO document_versions
      (document_id,version_number,original_name,stored_name,storage_path,mime_type,size_bytes,sha256,created_by_user_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id,version,safeDocumentName(file.originalname),path.basename(file.path),"documents/"+path.basename(file.path),file.mimetype,stat.size,sha256,userId || null]
  );
  await pool.query("UPDATE documents SET current_version=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [version,id]);
  return { version, sha256, sizeBytes: stat.size };
}

async function buildJobDocumentPdf(job, type) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(20).text("JR ELECTRICIDAD");
  doc.fillColor("#f59e0b").fontSize(9).text("Electricista Matriculado · Cat. 3");
  doc.moveDown(1.2);
  doc.fillColor("#111827").fontSize(16).text(type === "work_completion" ? "CONSTANCIA DE TRABAJO" : "INFORME DE TRABAJO");
  doc.moveDown(.8);
  const lines = [
    ["Trabajo", "#" + job.id],
    ["Cliente", job.client_name || "-"],
    ["Teléfono", job.client_phone || "-"],
    ["Servicio", job.service || "-"],
    ["Estado", job.status || "-"],
    ["Ubicación", job.location || "-"],
    ["Programado", job.scheduled_at ? new Date(job.scheduled_at).toLocaleString("es-AR") : "-"],
    ["Inicio", job.started_at ? new Date(job.started_at).toLocaleString("es-AR") : "-"],
    ["Finalización", job.completed_at ? new Date(job.completed_at).toLocaleString("es-AR") : "-"],
    ["Técnico", job.technician_name || "-"]
  ];
  for (const [label,value] of lines) {
    doc.fillColor("#6b7280").font("Helvetica-Bold").fontSize(9).text(label.toUpperCase());
    doc.fillColor("#111827").font("Helvetica").fontSize(11).text(String(value));
    doc.moveDown(.35);
  }
  if (job.execution_notes) {
    doc.moveDown(.4).fillColor("#111827").font("Helvetica-Bold").fontSize(10).text("NOTAS DE EJECUCIÓN");
    doc.font("Helvetica").fontSize(10).text(String(job.execution_notes));
  }
  if (job.completion_notes) {
    doc.moveDown(.4).fillColor("#111827").font("Helvetica-Bold").fontSize(10).text("NOTAS DE FINALIZACIÓN");
    doc.font("Helvetica").fontSize(10).text(String(job.completion_notes));
  }
  doc.moveDown(2);
  doc.fillColor("#6b7280").fontSize(8).text("Documento generado por el panel de administración de JR Electricidad.");
  return pdfToBuffer(doc);
}

async function createGeneratedPdfDocument({ title, type, pdf, clientId, quoteRequestId, quoteId, jobId, userId, fileName }) {
  const tmp = path.join(documentsDir, documentFileName(fileName || "documento.pdf"));
  await fs.promises.writeFile(tmp, pdf);
  try {
    return await createStoredDocument({
      title, documentType:type, clientId, quoteRequestId, quoteId, jobId,
      originalName:fileName || "documento.pdf",
      mimeType:"application/pdf", filePath:tmp, createdByUserId:userId
    });
  } catch (error) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw error;
  }
}

app.get("/api/admin/documents", requireAdmin, async (req,res)=>{
  try {
    const q=String(req.query.q||"").trim().slice(0,120);
    const type=String(req.query.type||"").trim();
    const params=[];
    const where=[];
    if(q){
      where.push("(d.title LIKE ? OR d.description LIKE ? OR dv.original_name LIKE ? OR c.name LIKE ?)");
      const like="%"+q+"%"; params.push(like,like,like,like);
    }
    if(type){
      const normalized=normalizeDocumentType(type);
      if(!normalized) return res.status(400).json({error:"Tipo de documento inválido."});
      where.push("d.document_type=?"); params.push(normalized);
    }
    const sql=`SELECT d.id,d.document_type,d.title,d.description,d.client_id,d.quote_request_id,d.quote_id,d.job_id,
      d.current_version,d.created_at,d.updated_at,
      dv.id AS version_id,dv.original_name,dv.mime_type,dv.size_bytes,dv.sha256,dv.created_at AS version_created_at,
      c.name AS client_name
      FROM documents d
      INNER JOIN document_versions dv ON dv.document_id=d.id AND dv.version_number=d.current_version
      LEFT JOIN clients c ON c.id=d.client_id
      ${where.length?"WHERE "+where.join(" AND "):""}
      ORDER BY d.updated_at DESC,d.id DESC LIMIT 200`;
    const [rows]=await pool.query(sql,params);
    res.json({types:DOCUMENT_TYPES,documents:rows});
  }catch(error){
    logError("Error listando documentos",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron obtener los documentos."});
  }
});

app.get("/api/admin/documents/:id(\\d+)", requireAdmin, async(req,res)=>{
  try{
    const id=validateDocumentEntityId(req.params.id);
    if(!id) return res.status(400).json({error:"ID de documento inválido."});
    const [docs]=await pool.query(
      `SELECT d.*,c.name AS client_name FROM documents d LEFT JOIN clients c ON c.id=d.client_id WHERE d.id=? LIMIT 1`,[id]);
    if(!docs.length) return res.status(404).json({error:"Documento no encontrado."});
    const [versions]=await pool.query(
      `SELECT v.id,v.version_number,v.original_name,v.mime_type,v.size_bytes,v.sha256,v.created_at,u.name AS created_by_name
       FROM document_versions v LEFT JOIN users u ON u.id=v.created_by_user_id WHERE v.document_id=? ORDER BY v.version_number DESC`,[id]);
    res.json({...docs[0],versions});
  }catch(error){res.status(500).json({error:"No se pudo obtener el documento."});}
});

app.get("/api/admin/documents/:id(\\d+)/download", requireAdmin, async(req,res)=>{
  try{
    const id=validateDocumentEntityId(req.params.id);
    const version=req.query.version==null?null:Number(req.query.version);
    if(!id) return res.status(400).json({error:"ID de documento inválido."});
    let sql=`SELECT d.title,v.* FROM documents d INNER JOIN document_versions v ON v.document_id=d.id
      WHERE d.id=? ${version? "AND v.version_number=?":"AND v.version_number=d.current_version"} LIMIT 1`;
    const params=version?[id,version]:[id];
    const [rows]=await pool.query(sql,params);
    if(!rows.length) return res.status(404).json({error:"Versión de documento no encontrada."});
    const filePath=documentAbsolutePath(rows[0].stored_name);
    if(!filePath || !fs.existsSync(filePath)) return res.status(404).json({error:"Archivo no encontrado en almacenamiento."});
    await writeAudit(req,"document_downloaded","document",id,{version:rows[0].version_number});
    res.setHeader("Content-Type",rows[0].mime_type);
    res.setHeader("Content-Disposition",`attachment; filename="${safeDocumentName(rows[0].original_name)}"`);
    res.sendFile(filePath);
  }catch(error){logError("Error descargando documento",{requestId:req.requestId,error:error.message});res.status(500).json({error:"No se pudo descargar el documento."});}
});

app.post("/api/admin/documents/upload", requireAdmin, adminMutationLimiter, documentUpload.single("file"), async(req,res)=>{
  try{
    if(!req.file) return res.status(400).json({error:"Seleccioná un archivo."});
    const documentType=normalizeDocumentType(req.body.document_type);
    if(!documentType){await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"Tipo de documento inválido."});}
    const result=await createStoredDocument({
      title:String(req.body.title||req.file.originalname).trim(),
      description:req.body.description,
      documentType,
      clientId:validateDocumentEntityId(req.body.client_id),
      quoteRequestId:validateDocumentEntityId(req.body.quote_request_id),
      quoteId:validateDocumentEntityId(req.body.quote_id),
      jobId:validateDocumentEntityId(req.body.job_id),
      originalName:req.file.originalname,mimeType:req.file.mimetype,filePath:req.file.path,
      createdByUserId:req.session.user.id
    });
    await writeAudit(req,"document_created","document",result.documentId,{document_type:documentType,version:1});
    res.status(201).json({success:true,...result});
  }catch(error){
    if(req.file) await fs.promises.unlink(req.file.path).catch(()=>{});
    logError("Error subiendo documento",{requestId:req.requestId,error:error.message});
    res.status(400).json({error:error.message||"No se pudo guardar el documento."});
  }
});

app.post("/api/admin/documents/:id(\\d+)/versions", requireAdmin, adminMutationLimiter, documentUpload.single("file"), async(req,res)=>{
  try{
    if(!req.file) return res.status(400).json({error:"Seleccioná un archivo."});
    const result=await createDocumentVersion(req.params.id,req.file,req.session.user.id);
    await writeAudit(req,"document_version_created","document",Number(req.params.id),{version:result.version});
    res.status(201).json({success:true,...result});
  }catch(error){
    if(req.file) await fs.promises.unlink(req.file.path).catch(()=>{});
    res.status(400).json({error:error.message||"No se pudo crear la versión."});
  }
});

app.post("/api/admin/documents/from-quote/:quoteId(\\d+)", requireAdmin, adminMutationLimiter, async(req,res)=>{
  try{
    const quoteId=validateDocumentEntityId(req.params.quoteId);
    if(!quoteId) return res.status(400).json({error:"ID de presupuesto inválido."});
    const quote=await getQuoteDetail(pool,quoteId);
    if(!quote) return res.status(404).json({error:"Presupuesto no encontrado."});
    const pdf=await pdfToBuffer(buildQuotePdf(quote));
    const result=await createGeneratedPdfDocument({
      title:"Presupuesto "+(quote.quote_number||quoteId),
      type:"quote_pdf",pdf,
      clientId:quote.client_id||null,quoteRequestId:quote.quote_request_id||null,quoteId,
      userId:req.session.user.id,fileName:`presupuesto-${quote.quote_number||quoteId}.pdf`
    });
    await writeAudit(req,"quote_document_generated","document",result.documentId,{quote_id:quoteId});
    res.status(201).json({success:true,...result});
  }catch(error){logError("Error generando documento de presupuesto",{requestId:req.requestId,error:error.message});res.status(500).json({error:"No se pudo generar el PDF del presupuesto."});}
});

app.post("/api/admin/documents/from-job/:jobId(\\d+)", requireAdmin, adminMutationLimiter, async(req,res)=>{
  try{
    const jobId=validateDocumentEntityId(req.params.jobId);
    if(!jobId) return res.status(400).json({error:"ID de trabajo inválido."});
    const [rows]=await pool.query(
      `SELECT j.*,qr.name AS client_name,qr.phone AS client_phone,qr.service,qu.quote_number,
        u.name AS technician_name,c.id AS client_id
       FROM jobs j
       LEFT JOIN quote_requests qr ON qr.id=j.quote_request_id
       LEFT JOIN quotes qu ON qu.id=j.quote_id
       LEFT JOIN clients c ON c.id=qr.client_id
       LEFT JOIN users u ON u.id=j.assigned_user_id
       WHERE j.id=? LIMIT 1`,[jobId]);
    if(!rows.length) return res.status(404).json({error:"Trabajo no encontrado."});
    const type=String(req.body.type||"job_report")==="work_completion"?"work_completion":"job_report";
    const pdf=await buildJobDocumentPdf(rows[0],type);
    const result=await createGeneratedPdfDocument({
      title:(type==="work_completion"?"Constancia de trabajo #":"Informe de trabajo #")+jobId,
      type,pdf,clientId:rows[0].client_id||null,quoteRequestId:rows[0].quote_request_id||null,quoteId:rows[0].quote_id||null,jobId,
      userId:req.session.user.id,fileName:`${type}-${jobId}.pdf`
    });
    await writeAudit(req,"job_document_generated","document",result.documentId,{job_id:jobId,type});
    res.status(201).json({success:true,...result});
  }catch(error){logError("Error generando documento de trabajo",{requestId:req.requestId,error:error.message});res.status(500).json({error:"No se pudo generar el documento del trabajo."});}
});

app.delete("/api/admin/documents/:id(\\d+)", requireAdmin, adminMutationLimiter, async(req,res)=>{
  const connection=await pool.getConnection();
  try{
    const id=validateDocumentEntityId(req.params.id);
    if(!id){connection.release();return res.status(400).json({error:"ID de documento inválido."});}
    const [versions]=await connection.query("SELECT stored_name FROM document_versions WHERE document_id=?",[id]);
    const [result]=await connection.query("DELETE FROM documents WHERE id=?",[id]);
    if(!result.affectedRows){connection.release();return res.status(404).json({error:"Documento no encontrado."});}
    await connection.commit().catch(()=>{});
    connection.release();
    for(const row of versions){const p=documentAbsolutePath(row.stored_name);if(p) await fs.promises.unlink(p).catch(()=>{});}
    await writeAudit(req,"document_deleted","document",id,{versions:versions.length});
    res.json({success:true,message:"Documento eliminado."});
  }catch(error){await connection.rollback().catch(()=>{});connection.release();res.status(500).json({error:"No se pudo eliminar el documento."});}
});

app.get("/api/admin/documents/:id(\\d+)/versions", requireAdmin, async(req,res)=>{
  try{
    const id=validateDocumentEntityId(req.params.id);
    if(!id) return res.status(400).json({error:"ID de documento inválido."});
    const [rows]=await pool.query(
      `SELECT v.*,u.name AS created_by_name FROM document_versions v LEFT JOIN users u ON u.id=v.created_by_user_id WHERE v.document_id=? ORDER BY v.version_number DESC`,[id]);
    res.json(rows);
  }catch(error){res.status(500).json({error:"No se pudieron obtener las versiones."});}
});


// =========================================================
// V2 — BACKUPS ADMINISTRATIVOS
// =========================================================

async function cleanupOldBackups() {
  const retentionDays = normalizeRetention(process.env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION);
  const [rows] = await pool.query(
    `SELECT id, storage_path FROM backups
     WHERE status='completed' AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
     ORDER BY created_at ASC LIMIT ?`,
    [retentionDays, MAX_BACKUPS]
  );

  for (const row of rows) {
    const backupPath = path.resolve(String(row.storage_path || ""));
    const backupRoot = path.resolve(getBackupDir());
    if (backupPath === backupRoot || !backupPath.startsWith(backupRoot + path.sep)) continue;
    await deleteFileIfExists(backupPath).catch(() => {});
    await pool.query("UPDATE backups SET status='deleted' WHERE id=?", [row.id]).catch(() => {});
  }

  const [overflow] = await pool.query(
    `SELECT id, storage_path FROM backups
     WHERE status='completed'
     ORDER BY created_at DESC, id DESC
     LIMIT 18446744073709551615 OFFSET ?`,
    [Math.max(0, MAX_BACKUPS)]
  );

  for (const row of overflow) {
    const backupPath = path.resolve(String(row.storage_path || ""));
    const backupRoot = path.resolve(getBackupDir());
    if (backupPath !== backupRoot && backupPath.startsWith(backupRoot + path.sep)) {
      await deleteFileIfExists(backupPath).catch(() => {});
    }
    await pool.query("UPDATE backups SET status='deleted' WHERE id=?", [row.id]).catch(() => {});
  }
}

app.get("/api/admin/backups", requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.id,b.filename,b.backup_type,b.size_bytes,b.sha256,b.status,
              b.created_at,b.completed_at,b.error_message,
              u.name AS created_by_name
       FROM backups b
       LEFT JOIN users u ON u.id=b.created_by_user_id
       ORDER BY b.created_at DESC,b.id DESC
       LIMIT 100`
    );
    const [countRows] = await pool.query(
      "SELECT COUNT(*) AS total FROM backups WHERE status='completed'"
    );
    res.json({
      backups: rows,
      total: Number(countRows[0]?.total || 0),
      retentionDays: normalizeRetention(process.env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION)
    });
  } catch (error) {
    logError("Error listando backups", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener los backups." });
  }
});

app.post("/api/admin/backups", requireAdmin, adminMutationLimiter, async (req, res) => {
  let created = null;
  try {
    created = await createDatabaseBackup();
    const [result] = await pool.query(
      `INSERT INTO backups
       (filename,storage_path,backup_type,size_bytes,sha256,status,created_by_user_id,completed_at)
       VALUES (?,?,?,?,?,'completed',?,CURRENT_TIMESTAMP)`,
      [
        created.filename,
        created.filePath,
        "database",
        created.sizeBytes,
        created.sha256,
        req.session.user.id
      ]
    );
    await writeAudit(req, "backup_created", "backup", result.insertId, {
      filename: created.filename,
      size_bytes: created.sizeBytes,
      sha256: created.sha256
    });
    await cleanupOldBackups();
    res.status(201).json({
      success: true,
      id: result.insertId,
      filename: created.filename,
      size_bytes: created.sizeBytes,
      sha256: created.sha256,
      message: "Backup de la base de datos creado correctamente."
    });
  } catch (error) {
    if (created?.filePath) await deleteFileIfExists(created.filePath).catch(() => {});
    logError("Error creando backup", { requestId: req.requestId, error: error.message });
    await writeAudit(req, "backup_failed", "backup", null, { error: error.message });
    res.status(500).json({
      error: "No se pudo crear el backup. Verificá que mysqldump esté instalado y configurado.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message
    });
  }
});

app.get("/api/admin/backups/:id/download", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "ID de backup inválido." });

    const [rows] = await pool.query(
      "SELECT id,filename,storage_path,status FROM backups WHERE id=? LIMIT 1",
      [id]
    );
    if (!rows.length || rows[0].status !== "completed") {
      return res.status(404).json({ error: "Backup no disponible." });
    }

    const backupRoot = path.resolve(getBackupDir());
    const backupPath = path.resolve(String(rows[0].storage_path || ""));
    if (backupPath === backupRoot || !backupPath.startsWith(backupRoot + path.sep)) {
      return res.status(403).json({ error: "Ruta de backup no autorizada." });
    }

    try {
      await fs.promises.access(backupPath, fs.constants.R_OK);
    } catch {
      return res.status(404).json({ error: "El archivo del backup no existe en el almacenamiento." });
    }

    await writeAudit(req, "backup_downloaded", "backup", id, { filename: rows[0].filename });
    res.download(backupPath, rows[0].filename);
  } catch (error) {
    logError("Error descargando backup", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo descargar el backup." });
  }
});

app.delete("/api/admin/backups/:id", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "ID de backup inválido." });

    const [rows] = await pool.query(
      "SELECT id,filename,storage_path,status FROM backups WHERE id=? LIMIT 1",
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Backup no encontrado." });

    const backupRoot = path.resolve(getBackupDir());
    const backupPath = path.resolve(String(rows[0].storage_path || ""));
    if (backupPath !== backupRoot && backupPath.startsWith(backupRoot + path.sep)) {
      await deleteFileIfExists(backupPath);
    }

    await pool.query("UPDATE backups SET status='deleted' WHERE id=?", [id]);
    await writeAudit(req, "backup_deleted", "backup", id, { filename: rows[0].filename });
    res.json({ success: true, message: "Backup eliminado." });
  } catch (error) {
    logError("Error eliminando backup", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo eliminar el backup." });
  }
});

app.post("/api/admin/backups/cleanup", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    await cleanupOldBackups();
    await writeAudit(req, "backup_cleanup", "backup", null, {
      retention_days: normalizeRetention(process.env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION)
    });
    res.json({ success: true, message: "Limpieza de backups completada." });
  } catch (error) {
    logError("Error limpiando backups", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo completar la limpieza." });
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

start();,
      tax_enabled TINYINT(1) NOT NULL DEFAULT 0,
      tax_name VARCHAR(80) NOT NULL DEFAULT 'IVA',
      tax_rate DECIMAL(6,3) NOT NULL DEFAULT 0,
      quote_prefix VARCHAR(20) NOT NULL DEFAULT 'PR-',
      quote_next_number INT UNSIGNED NOT NULL DEFAULT 1,
      job_prefix VARCHAR(20) NOT NULL DEFAULT 'TR-',
      job_next_number INT UNSIGNED NOT NULL DEFAULT 1,
      quote_validity_days INT UNSIGNED NOT NULL DEFAULT 15,
      quote_default_notes TEXT,
      quote_terms TEXT,
      commercial_conditions TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const columns = [
    ["whatsapp_enabled","TINYINT(1) NOT NULL DEFAULT 0"],
    ["whatsapp_auto_notifications","TINYINT(1) NOT NULL DEFAULT 0"],
    ["currency_code","VARCHAR(10) NOT NULL DEFAULT 'ARS'"],
    ["currency_symbol","VARCHAR(10) NOT NULL DEFAULT '

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
        whatsapp_enabled: Boolean(req.body.whatsapp_enabled),
        whatsapp_auto_notifications: Boolean(req.body.whatsapp_auto_notifications),
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
            whatsapp_enabled=?, whatsapp_auto_notifications=?,
            email=?, address=?, city=?, hours=?, logo_url=?,
            pdf_footer=?, pdf_notes=?
        WHERE id=1
        `,
        [
          fields.business_name,
          fields.legal_name,
          fields.phone,
          fields.whatsapp,
          fields.whatsapp_enabled ? 1 : 0,
          fields.whatsapp_auto_notifications ? 1 : 0,
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
  async (req, res) => {
    if (!req.session.user) return res.json({ user: null });

    try {
      const [rows] = await pool.query(
        `SELECT id, name, email, role, email_verified_at, pending_email, avatar_url, totp_enabled
         FROM users WHERE id=? LIMIT 1`,
        [Number(req.session.user.id)]
      );
      if (!rows.length) return res.json({ user: null });

      req.session.user = {
        ...req.session.user,
        id: rows[0].id,
        name: rows[0].name,
        email: rows[0].email,
        role: rows[0].role
      };

      res.json({ user: cleanUser(rows[0]) });
    } catch (error) {
      logError("Error obteniendo usuario actual", { requestId: req.requestId, error: error.message });
      res.status(500).json({ error: "No se pudo obtener la cuenta." });
    }
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

      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({ error: passwordError });
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
      await registerActiveSession(req, result.insertId);
      await writeAudit(req, "register", "user", result.insertId);
      try {
        await sendEmailVerification(result.insertId, normalized);
      } catch (mailError) {
        logError("No se pudo enviar verificación tras registro", {
          requestId: req.requestId,
          userId: result.insertId,
          error: mailError.message
        });
      }

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
            created_at,
            email_verified_at,
            avatar_url,
            totp_enabled
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
    const userId = req.session?.user?.id || null;
    const sessionId = req.sessionID;

    req.session.destroy(
      () => {
        removeActiveSession(sessionId);
        if (userId) {
          writeAudit(req, "logout", "user", userId);
        }

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
        password.length < PASSWORD_MIN ||
        password.length > PASSWORD_MAX
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

    // V2: vincular automáticamente la solicitud con un cliente existente.
    let clientId = null;
    const clientQuery = await pool.query("SELECT id FROM clients WHERE phone=? LIMIT 1", [cleanPhone]);
    const clientRows = clientQuery[0];
    if (clientRows.length) {
      clientId = clientRows[0].id;
      await pool.query(
        `UPDATE clients SET name=?, email=COALESCE(NULLIF(?, ''), email) WHERE id=?`,
        [cleanName, cleanEmail || "", clientId]
      );
    } else {
      const clientQueryResult = await pool.query(
        `INSERT INTO clients (name, phone, email) VALUES (?, ?, ?)`,
        [cleanName, cleanPhone, cleanEmail || null]
      );
      clientId = clientQueryResult[0].insertId;
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
        image_url,
        client_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        cleanName,
        cleanPhone,
        cleanEmail,
        cleanService,
        cleanDescription,
        preferred_date || null,
        imageUrl,
        clientId
      ]
    );

    // La solicitud ya fue guardada correctamente. La notificación
    // nunca debe hacer fallar el envío de la solicitud.
    try {
      await createAdminNotification({
        type: "quote_request_created",
        message: `Nueva solicitud de presupuesto de ${cleanName}.`,
        entityType: "quote_request",
        entityId: result.insertId,
        linkUrl: "/admin.html#quoteRequestsSection",
        priority: "high"
      });
    } catch (notificationError) {
      logError("Solicitud guardada, pero no se pudo crear la notificación", {
        requestId: req.requestId,
        error: notificationError.message
      });
    }

    const [createdRequestRows] = await pool.query(
      "SELECT id,name,email,phone,whatsapp,service,status FROM quote_requests WHERE id=? LIMIT 1",
      [result.insertId]
    );
    if (createdRequestRows.length) {
      await notifyRequestCustomer(
        createdRequestRows[0],
        "Solicitud recibida - JR Electricidad",
        "Recibimos correctamente tu solicitud de presupuesto."
      );
      await notifyRequestWhatsApp(
        createdRequestRows[0],
        `JR Electricidad: recibimos tu solicitud #${createdRequestRows[0].id}. Te contactaremos luego de revisarla.`
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
// GALERÍA V2 — PÚBLICA + ADMIN
// =========================================================

const GALLERY_CATEGORIES = [
  "instalaciones",
  "reparaciones",
  "tableros",
  "iluminacion",
  "mantenimiento",
  "otros"
];

function parseOptionalId(value) {
  if (value === "" || value === null || value === undefined) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateGalleryCategory(value) {
  const category = String(value || "otros").trim().toLowerCase();
  return GALLERY_CATEGORIES.includes(category) ? category : null;
}

function galleryCategoryLabel(category) {
  return ({
    instalaciones: "Instalaciones",
    reparaciones: "Reparaciones",
    tableros: "Tableros eléctricos",
    iluminacion: "Iluminación",
    mantenimiento: "Mantenimiento",
    otros: "Otros"
  })[category] || "Otros";
}

async function validateGalleryRelations({ clientId, jobId, quoteId }) {
  if (clientId !== null) {
    const [rows] = await pool.query("SELECT id FROM clients WHERE id=? LIMIT 1", [clientId]);
    if (!rows.length) return "El cliente vinculado no existe.";
  }
  if (quoteId !== null) {
    const [rows] = await pool.query("SELECT id, quote_request_id FROM quotes WHERE id=? LIMIT 1", [quoteId]);
    if (!rows.length) return "El presupuesto vinculado no existe.";
  }
  if (jobId !== null) {
    const [rows] = await pool.query(
      "SELECT j.id, j.status, j.quote_id FROM jobs j WHERE j.id=? LIMIT 1",
      [jobId]
    );
    if (!rows.length) return "El trabajo vinculado no existe.";
    if (!["finalizado", "cerrado"].includes(rows[0].status)) {
      return "Solo se pueden publicar trabajos de la galería vinculados a trabajos finalizados o cerrados.";
    }
  }
  if (jobId !== null && quoteId !== null) {
    const [rows] = await pool.query("SELECT id FROM jobs WHERE id=? AND quote_id=? LIMIT 1", [jobId, quoteId]);
    if (!rows.length) return "El trabajo y el presupuesto vinculados no corresponden entre sí.";
  }
  if (jobId !== null && clientId !== null) {
    const [rows] = await pool.query(
      "SELECT j.id FROM jobs j INNER JOIN quotes q ON q.id=j.quote_id INNER JOIN quote_requests qr ON qr.id=q.quote_request_id WHERE j.id=? AND qr.client_id=? LIMIT 1",
      [jobId, clientId]
    );
    if (!rows.length) return "El trabajo y el cliente vinculados no corresponden entre sí.";
  }
  return null;
}

async function deleteGalleryFile(imageUrl) {
  if (!imageUrl || !String(imageUrl).startsWith("/uploads/")) return;
  const imageFile = path.join(__dirname, "public", String(imageUrl).replace(/^\/+/, ""));
  if (fs.existsSync(imageFile)) await fs.promises.unlink(imageFile).catch(() => {});
}

app.get("/api/gallery", async (req, res) => {
  try {
    const category = String(req.query.category || "").trim().toLowerCase();
    const params = [];
    let sql = "SELECT id,title,description,image_url,alt_text,category,featured,sort_order,client_id,job_id,quote_id,created_at FROM gallery WHERE active=1";
    if (category && GALLERY_CATEGORIES.includes(category)) {
      sql += " AND category=?";
      params.push(category);
    }
    sql += " ORDER BY featured DESC,sort_order ASC,created_at DESC";
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo galería pública", {requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron cargar los trabajos."});
  }
});

app.get("/api/admin/gallery", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const category = String(req.query.category || "").trim().toLowerCase();
    const status = String(req.query.status || "").trim().toLowerCase();
    const params = [];
    let sql = "SELECT g.id,g.title,g.description,g.image_url,g.alt_text,g.active,g.featured,g.sort_order,g.category,g.client_id,g.job_id,g.quote_id,g.created_at,g.updated_at,c.name AS client_name,j.status AS job_status,q.quote_number FROM gallery g LEFT JOIN clients c ON c.id=g.client_id LEFT JOIN jobs j ON j.id=g.job_id LEFT JOIN quotes q ON q.id=g.quote_id WHERE 1=1";
    if (search) {
      const v = "%" + search + "%";
      sql += " AND (g.title LIKE ? OR g.description LIKE ? OR g.alt_text LIKE ? OR g.category LIKE ? OR c.name LIKE ? OR q.quote_number LIKE ?)";
      params.push(v,v,v,v,v,v);
    }
    if (category && GALLERY_CATEGORIES.includes(category)) {
      sql += " AND g.category=?";
      params.push(category);
    }
    if (status === "active") sql += " AND g.active=1";
    if (status === "inactive") sql += " AND g.active=0";
    if (status === "featured") sql += " AND g.featured=1";
    sql += " ORDER BY g.sort_order ASC,g.created_at DESC";
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo galería admin", {requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron cargar los trabajos."});
  }
});

app.get("/api/admin/gallery/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query(
      "SELECT g.*,c.name AS client_name,j.status AS job_status,q.quote_number FROM gallery g LEFT JOIN clients c ON c.id=g.client_id LEFT JOIN jobs j ON j.id=g.job_id LEFT JOIN quotes q ON q.id=g.quote_id WHERE g.id=? LIMIT 1",
      [id]
    );
    if (!rows.length) return res.status(404).json({error:"Trabajo de galería no encontrado."});
    res.json(rows[0]);
  } catch (error) {
    logError("Error obteniendo detalle de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el trabajo de galería."});
  }
});

app.post("/api/admin/gallery", requireAdmin, adminMutationLimiter, upload.single("image"), validateUploadedImage, async (req, res) => {
  try {
    const title=String(req.body.title||"").trim();
    const description=String(req.body.description||"").trim();
    const altText=String(req.body.alt_text||req.body.altText||title).trim();
    const category=validateGalleryCategory(req.body.category);
    const active=["true","1"].includes(String(req.body.active))?1:0;
    const featured=["true","1"].includes(String(req.body.featured))?1:0;
    const clientId=parseOptionalId(req.body.client_id);
    const jobId=parseOptionalId(req.body.job_id);
    const quoteId=parseOptionalId(req.body.quote_id);

    if(!title||title.length>150){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El título es obligatorio y no puede superar 150 caracteres."});}
    if(description.length>500){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"La descripción no puede superar 500 caracteres."});}
    if(!altText||altText.length>255){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El texto alternativo es obligatorio y no puede superar 255 caracteres."});}
    if(!category){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"La categoría seleccionada no es válida."});}
    const relationError=await validateGalleryRelations({clientId,jobId,quoteId});
    if(relationError){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:relationError});}
    if(!req.file)return res.status(400).json({error:"Debes seleccionar una imagen."});

    const imageUrl="/uploads/"+req.file.filename;
    const [[orderRow]]=await pool.query("SELECT COALESCE(MAX(sort_order),0)+1 AS next_order FROM gallery");
    const sortOrder=Number(orderRow.next_order||1);
    const [result]=await pool.query(
      "INSERT INTO gallery (title,description,image_url,alt_text,category,active,featured,sort_order,client_id,job_id,quote_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [title,description,imageUrl,altText,category,active,featured,sortOrder,clientId,jobId,quoteId]
    );
    await writeAudit(req,"gallery_created","gallery",result.insertId,{category,featured,jobId,quoteId,clientId});
    if (active) {
      await createAdminNotification({
        type: "gallery_published",
        message: `La galería publicó "${title}".`,
        entityType: "gallery",
        entityId: result.insertId,
        quoteId,
        linkUrl: "/admin.html#gallerySection",
        priority: featured ? "high" : "normal"
      }).catch(() => {});
    }
    res.status(201).json({ok:true,message:"Trabajo agregado correctamente.",id:result.insertId,image_url:imageUrl});
  } catch(error) {
    if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});
    logError("Error agregando trabajo de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo agregar el trabajo."});
  }
});

app.put("/api/admin/gallery/:id(\\d+)", requireAdmin, adminMutationLimiter, upload.single("image"), validateUploadedImage, async (req, res) => {
  try {
    const id=Number(req.params.id);
    const [[existing]]=await pool.query("SELECT * FROM gallery WHERE id=? LIMIT 1",[id]);
    if(!existing){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(404).json({error:"Trabajo no encontrado."});}

    const title=String(req.body.title||"").trim();
    const description=String(req.body.description||"").trim();
    const altText=String(req.body.alt_text||req.body.altText||title).trim();
    const category=validateGalleryCategory(req.body.category);
    const active=["true","1"].includes(String(req.body.active))?1:0;
    const featured=["true","1"].includes(String(req.body.featured))?1:0;
    const clientId=parseOptionalId(req.body.client_id);
    const jobId=parseOptionalId(req.body.job_id);
    const quoteId=parseOptionalId(req.body.quote_id);

    if(!title||title.length>150){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El título es obligatorio y no puede superar 150 caracteres."});}
    if(description.length>500){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"La descripción no puede superar 500 caracteres."});}
    if(!altText||altText.length>255){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El texto alternativo es obligatorio y no puede superar 255 caracteres."});}
    if(!category){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"La categoría seleccionada no es válida."});}

    const relationError=await validateGalleryRelations({clientId,jobId,quoteId});
    if(relationError){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:relationError});}

    let imageUrl=existing.image_url;
    if(req.file)imageUrl="/uploads/"+req.file.filename;

    await pool.query(
      "UPDATE gallery SET title=?,description=?,image_url=?,alt_text=?,category=?,active=?,featured=?,client_id=?,job_id=?,quote_id=? WHERE id=?",
      [title,description,imageUrl,altText,category,active,featured,clientId,jobId,quoteId,id]
    );
    if(req.file&&existing.image_url!==imageUrl&&!existing.source_job_attachment_id)await deleteGalleryFile(existing.image_url);
    await writeAudit(req,"gallery_updated","gallery",id,{category,featured,jobId,quoteId,clientId});
    if (!Number(existing.active) && active) {
      await createAdminNotification({
        type: "gallery_published",
        message: `La galería publicó "${title}".`,
        entityType: "gallery",
        entityId: id,
        quoteId,
        linkUrl: "/admin.html#gallerySection",
        priority: featured ? "high" : "normal"
      }).catch(() => {});
    }
    res.json({ok:true,message:"Trabajo actualizado correctamente."});
  }catch(error){
    if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});
    logError("Error editando trabajo de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el trabajo."});
  }
});

app.delete("/api/admin/gallery/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req,res)=>{
  try{
    const id=Number(req.params.id);
    const [[existing]]=await pool.query("SELECT image_url,source_job_attachment_id FROM gallery WHERE id=? LIMIT 1",[id]);
    if(!existing)return res.status(404).json({error:"Trabajo no encontrado."});
    await pool.query("DELETE FROM gallery WHERE id=?",[id]);
    if(!existing.source_job_attachment_id)await deleteGalleryFile(existing.image_url);
    await writeAudit(req,"gallery_deleted","gallery",id);
    res.json({ok:true,message:"Trabajo eliminado correctamente."});
  }catch(error){
    logError("Error eliminando trabajo de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo eliminar el trabajo."});
  }
});

app.put("/api/admin/gallery/:id(\\d+)/order", requireAdmin, adminMutationLimiter, async (req,res)=>{
  try{
    const id=Number(req.params.id);
    const direction=String(req.body.direction||"");
    if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:"ID inválido."});
    if(!["up","down"].includes(direction))return res.status(400).json({error:"Dirección inválida."});
    const [[current]]=await pool.query("SELECT id,sort_order FROM gallery WHERE id=? LIMIT 1",[id]);
    if(!current)return res.status(404).json({error:"Trabajo no encontrado."});
    const comparison=direction==="up"?"<":">";
    const orderDirection=direction==="up"?"DESC":"ASC";
    const [[neighbor]]=await pool.query(
      "SELECT id,sort_order FROM gallery WHERE sort_order "+comparison+" ? ORDER BY sort_order "+orderDirection+", id "+orderDirection+" LIMIT 1",
      [current.sort_order]
    );
    if(!neighbor)return res.json({ok:true,message:direction==="up"?"Ya está primero.":"Ya está último."});
    await pool.query("UPDATE gallery SET sort_order=? WHERE id=?",[neighbor.sort_order,current.id]);
    await pool.query("UPDATE gallery SET sort_order=? WHERE id=?",[current.sort_order,neighbor.id]);
    await writeAudit(req,"gallery_reordered","gallery",id,{direction});
    res.json({ok:true,message:"Orden actualizado correctamente."});
  }catch(error){
    logError("Error cambiando orden de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo cambiar el orden."});
  }
});

app.post("/api/admin/gallery/from-job-attachment/:attachmentId(\\d+)", requireAdmin, adminMutationLimiter, async (req,res)=>{
  try{
    const attachmentId=Number(req.params.attachmentId);
    const [[attachment]]=await pool.query(
      "SELECT ja.*,j.status AS job_status,j.quote_id,qr.client_id,qr.service,qr.description,q.quote_number FROM job_attachments ja INNER JOIN jobs j ON j.id=ja.job_id INNER JOIN quotes q ON q.id=j.quote_id INNER JOIN quote_requests qr ON qr.id=q.quote_request_id WHERE ja.id=? LIMIT 1",
      [attachmentId]
    );
    if(!attachment)return res.status(404).json({error:"La evidencia no existe."});
    if(!["image/jpeg","image/png","image/webp","image/gif"].includes(attachment.mime_type))return res.status(400).json({error:"Solo se pueden publicar imágenes como trabajos de galería."});
    if(!["finalizado","cerrado"].includes(attachment.job_status))return res.status(400).json({error:"Solo se pueden publicar evidencias de trabajos finalizados o cerrados."});

    const title=String(req.body.title||attachment.service||"Trabajo realizado").trim();
    const description=String(req.body.description||attachment.description||"").trim();
    const altText=String(req.body.alt_text||title).trim();
    const category=validateGalleryCategory(req.body.category||"otros");
    const active=["true","1"].includes(String(req.body.active??"1"))?1:0;
    const featured=["true","1"].includes(String(req.body.featured))?1:0;
    if(!title||title.length>150)return res.status(400).json({error:"El título es obligatorio y no puede superar 150 caracteres."});
    if(description.length>500)return res.status(400).json({error:"La descripción no puede superar 500 caracteres."});
    if(!altText||altText.length>255)return res.status(400).json({error:"El texto alternativo no es válido."});
    if(!category)return res.status(400).json({error:"La categoría no es válida."});

    const [[duplicate]]=await pool.query("SELECT id FROM gallery WHERE job_id=? AND image_url=? LIMIT 1",[attachment.job_id,attachment.url]);
    if(duplicate)return res.status(409).json({error:"Esta evidencia ya está publicada en la galería.",id:duplicate.id});

    const [[orderRow]]=await pool.query("SELECT COALESCE(MAX(sort_order),0)+1 AS next_order FROM gallery");
    const [result]=await pool.query(
      "INSERT INTO gallery (title,description,image_url,alt_text,category,active,featured,sort_order,client_id,job_id,quote_id,source_job_attachment_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [title,description,attachment.url,altText,category,active,featured,Number(orderRow.next_order||1),attachment.client_id||null,attachment.job_id,attachment.quote_id,attachmentId]
    );
    await writeAudit(req,"gallery_promoted_from_job_attachment","gallery",result.insertId,{attachmentId,jobId:attachment.job_id});
    if (active) {
      await createAdminNotification({
        type: "gallery_published",
        message: `La evidencia del trabajo #${attachment.job_id} fue publicada en la galería.`,
        entityType: "gallery",
        entityId: result.insertId,
        quoteId: attachment.quote_id,
        linkUrl: "/admin.html#gallerySection",
        priority: featured ? "high" : "normal"
      }).catch(() => {});
    }
    res.status(201).json({ok:true,id:result.insertId,message:"La evidencia fue publicada en la galería."});
  }catch(error){
    logError("Error promocionando evidencia a galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo publicar la evidencia en la galería."});
  }
});

app.get("/api/admin/gallery/categories", requireAdmin, (req,res)=>{
  res.json(GALLERY_CATEGORIES.map(value=>({value,label:galleryCategoryLabel(value)})));
});

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
// ADMIN - CLIENTES V2
// =========================================================

function cleanClientInput(body) {
  return {
    name: String(body.name || "").trim(),
    phone: String(body.phone || "").trim(),
    whatsapp: String(body.whatsapp || "").trim(),
    email: normalizeEmail(body.email),
    address: String(body.address || "").trim(),
    locality: String(body.locality || "").trim(),
    notes: String(body.notes || "").trim()
  };
}

function validateClientInput(client) {
  if (!client.name || client.name.length > 150) return "El nombre es obligatorio y no puede superar 150 caracteres.";
  if (!client.phone || client.phone.length > 50) return "El teléfono es obligatorio y no puede superar 50 caracteres.";
  if (client.whatsapp.length > 50) return "El WhatsApp no puede superar 50 caracteres.";
  if (client.email && !validEmail(client.email)) return "El email del cliente no es válido.";
  if (client.address.length > 255) return "La dirección no puede superar 255 caracteres.";
  if (client.locality.length > 120) return "La localidad no puede superar 120 caracteres.";
  if (client.notes.length > 5000) return "Las notas no pueden superar 5000 caracteres.";
  return null;
}

app.get("/api/admin/clients", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const locality = String(req.query.locality || "").trim();
    const params = [];
    let sql = `
      SELECT
        c.id, c.user_id, c.name, c.phone, c.whatsapp, c.email,
        c.address, c.locality, c.notes, c.created_at, c.updated_at,
        COUNT(DISTINCT qr.id) AS requests,
        COUNT(DISTINCT q.id) AS quotes,
        COUNT(DISTINCT j.id) AS jobs,
        MAX(COALESCE(j.updated_at, q.updated_at, qr.created_at, c.updated_at)) AS last_activity
      FROM clients c
      LEFT JOIN quote_requests qr ON qr.client_id=c.id
      LEFT JOIN quotes q ON q.quote_request_id=qr.id
      LEFT JOIN jobs j ON j.quote_id=q.id
      WHERE 1=1
    `;

    if (search) {
      sql += ` AND (c.name LIKE ? OR c.phone LIKE ? OR c.whatsapp LIKE ? OR c.email LIKE ? OR c.address LIKE ? OR c.locality LIKE ?) `;
      const v = `%${search}%`;
      params.push(v,v,v,v,v,v);
    }
    if (locality) {
      sql += " AND c.locality LIKE ?";
      params.push(`%${locality}%`);
    }

    sql += `
      GROUP BY c.id
      ORDER BY last_activity DESC, c.name ASC
    `;

    const [rows] = await pool.query(sql, params);
    res.json({
      success: true,
      clients: rows.map(c => ({
        ...c,
        requests: Number(c.requests || 0),
        quotes: Number(c.quotes || 0),
        jobs: Number(c.jobs || 0)
      }))
    });
  } catch (error) {
    logError("Error obteniendo clientes", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener los clientes." });
  }
});

app.post("/api/admin/clients", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const client = cleanClientInput(req.body);
    const validationError = validateClientInput(client);
    if (validationError) return res.status(400).json({ error: validationError });

    const [existing] = await pool.query("SELECT id FROM clients WHERE phone=? LIMIT 1", [client.phone]);
    if (existing.length) return res.status(409).json({ error: "Ya existe un cliente con ese teléfono." });

    const [result] = await pool.query(
      `INSERT INTO clients (name,phone,whatsapp,email,address,locality,notes)
       VALUES (?,?,?,?,?,?,?)`,
      [client.name,client.phone,client.whatsapp||null,client.email||null,client.address||null,client.locality||null,client.notes||null]
    );
    await writeAudit(req, "client_created", "client", result.insertId);
    res.status(201).json({ success:true, client:{ id:result.insertId, ...client } });
  } catch (error) {
    logError("Error creando cliente", { requestId:req.requestId, error:error.message });
    res.status(500).json({ error:"No se pudo crear el cliente." });
  }
});

app.get("/api/admin/clients/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id=Number(req.params.id);
    if (!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de cliente inválido."});
    const [rows]=await pool.query("SELECT * FROM clients WHERE id=? LIMIT 1",[id]);
    if (!rows.length) return res.status(404).json({error:"Cliente no encontrado."});
    res.json({success:true,client:rows[0]});
  } catch(error) {
    logError("Error obteniendo cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el cliente."});
  }
});

app.put("/api/admin/clients/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const id=Number(req.params.id);
    if (!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de cliente inválido."});
    const client=cleanClientInput(req.body);
    const validationError=validateClientInput(client);
    if (validationError) return res.status(400).json({error:validationError});

    const [existing]=await pool.query("SELECT id FROM clients WHERE phone=? AND id<>? LIMIT 1",[client.phone,id]);
    if(existing.length) return res.status(409).json({error:"Ya existe otro cliente con ese teléfono."});

    const [result]=await pool.query(
      `UPDATE clients SET name=?,phone=?,whatsapp=?,email=?,address=?,locality=?,notes=? WHERE id=?`,
      [client.name,client.phone,client.whatsapp||null,client.email||null,client.address||null,client.locality||null,client.notes||null,id]
    );
    if(!result.affectedRows) return res.status(404).json({error:"Cliente no encontrado."});
    await writeAudit(req,"client_updated","client",id);
    const [rows]=await pool.query("SELECT * FROM clients WHERE id=? LIMIT 1",[id]);
    res.json({success:true,message:"Cliente actualizado correctamente.",client:rows[0]});
  } catch(error) {
    logError("Error actualizando cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el cliente."});
  }
});

app.delete("/api/admin/clients/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de cliente inválido."});
    const [result]=await pool.query("DELETE FROM clients WHERE id=?",[id]);
    if(!result.affectedRows) return res.status(404).json({error:"Cliente no encontrado."});
    await writeAudit(req,"client_deleted","client",id);
    res.json({success:true,message:"Cliente eliminado correctamente."});
  } catch(error) {
    logError("Error eliminando cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo eliminar el cliente."});
  }
});

app.get("/api/admin/clients/:id(\\d+)/history", requireAdmin, async (req, res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de cliente inválido."});

    const [clientRows]=await pool.query("SELECT * FROM clients WHERE id=? LIMIT 1",[id]);
    if(!clientRows.length) return res.status(404).json({error:"Cliente no encontrado."});

    const [requests]=await pool.query(
      `SELECT id,name,phone,email,service,description,preferred_date,image_url,status,created_at
       FROM quote_requests WHERE client_id=? ORDER BY created_at DESC`,[id]
    );
    const [quotes]=await pool.query(
      `SELECT q.id,q.quote_number,q.issue_date,q.expiration_date,q.status,q.subtotal,q.discount,q.total,
              q.created_at,q.updated_at,j.id AS job_id,j.status AS job_status,j.started_at,j.completed_at
       FROM quotes q
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       LEFT JOIN jobs j ON j.quote_id=q.id
       WHERE qr.client_id=? ORDER BY q.created_at DESC`,[id]
    );
    const [jobs]=await pool.query(
      `SELECT j.id,j.quote_id,j.status,j.started_at,j.completed_at,j.created_at,j.updated_at,
              q.quote_number, q.total,
              qr.service,qr.description
       FROM jobs j
       INNER JOIN quotes q ON q.id=j.quote_id
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE qr.client_id=? ORDER BY j.created_at DESC`,[id]
    );

    res.json({
      success:true,
      client:clientRows[0],
      requests,quotes,jobs,
      summary:{
        requests:requests.length,
        quotes:quotes.length,
        jobs:jobs.length,
        completedJobs:jobs.filter(j=>j.status==="cerrado").length,
        totalQuoted:quotes.reduce((sum,q)=>sum+Number(q.total||0),0)
      }
    });
  } catch(error) {
    logError("Error obteniendo historial del cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el historial del cliente."});
  }
});

// Compatibilidad V1: ficha por teléfono/email.
app.get("/api/admin/clients/detail", requireAdmin, async (req,res)=>{
  try {
    const phone=String(req.query.phone||"").trim();
    const email=normalizeEmail(req.query.email);
    if(!phone) return res.status(400).json({error:"El teléfono del cliente es obligatorio."});
    const [rows]=await pool.query("SELECT id FROM clients WHERE phone=? LIMIT 1",[phone]);
    if(!rows.length) return res.status(404).json({error:"No se encontró el cliente."});
    const id=rows[0].id;
    const [clientRows]=await pool.query("SELECT * FROM clients WHERE id=? LIMIT 1",[id]);
    const [requests]=await pool.query("SELECT id,name,phone,email,service,description,preferred_date,image_url,status,created_at FROM quote_requests WHERE client_id=? ORDER BY created_at DESC",[id]);
    const [quotes]=await pool.query(
      `SELECT q.id,q.quote_number,q.issue_date,q.expiration_date,q.status,q.subtotal,q.discount,q.total,q.created_at,q.updated_at,
              j.id AS job_id,j.status AS job_status,j.started_at,j.completed_at
       FROM quotes q INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       LEFT JOIN jobs j ON j.quote_id=q.id WHERE qr.client_id=? ORDER BY q.created_at DESC`,[id]
    );
    res.json({success:true,client:clientRows[0],requests,quotes});
  } catch(error) {
    logError("Error obteniendo ficha compatible del cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener la ficha del cliente."});
  }
});

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

      const [[clientsSummary]] = await pool.query(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN 1 ELSE 0 END) AS newClients
         FROM clients`,
        [days]
      );

      const [[gallerySummary]] = await pool.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) AS published,
                SUM(CASE WHEN featured=1 AND active=1 THEN 1 ELSE 0 END) AS featured
         FROM gallery`
      );

      const [[requestPipeline]] = await pool.query(
        `SELECT
          SUM(CASE WHEN status='pendiente' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status='en_revision' THEN 1 ELSE 0 END) AS review,
          SUM(CASE WHEN status='presupuestando' THEN 1 ELSE 0 END) AS quoting,
          SUM(CASE WHEN status='presupuestada' THEN 1 ELSE 0 END) AS quoted,
          SUM(CASE WHEN status='aceptada' THEN 1 ELSE 0 END) AS accepted
         FROM quote_requests`
      );

      const [upcomingJobs] = await pool.query(
        `SELECT j.id,j.status,j.scheduled_at,j.location,
                COALESCE(c.name,qr.name,'Sin cliente') AS client_name,
                u.name AS technician_name
         FROM jobs j
         LEFT JOIN clients c ON c.id=j.client_id
         LEFT JOIN quote_requests qr ON qr.id=j.quote_request_id
         LEFT JOIN users u ON u.id=j.assigned_user_id
         WHERE j.scheduled_at IS NOT NULL
           AND j.scheduled_at >= NOW()
           AND j.status IN ('aceptado','programado','en_proceso','pausado')
         ORDER BY j.scheduled_at ASC
         LIMIT 8`
      );

      const [topServices] = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(qr.service),''),'Sin servicio') AS service,
                COUNT(*) AS requests,
                SUM(CASE WHEN qr.status='aceptada' THEN 1 ELSE 0 END) AS accepted
         FROM quote_requests qr
         GROUP BY COALESCE(NULLIF(TRIM(qr.service),''),'Sin servicio')
         ORDER BY requests DESC, accepted DESC
         LIMIT 6`
      );

      const [jobStatusSummary] = await pool.query(
        `SELECT status,COUNT(*) AS total
         FROM jobs
         GROUP BY status
         ORDER BY total DESC`
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
        recentActivity,
        clients: {
          total: Number(clientsSummary.total || 0),
          newClients: Number(clientsSummary.newClients || 0)
        },
        gallery: {
          total: Number(gallerySummary.total || 0),
          published: Number(gallerySummary.published || 0),
          featured: Number(gallerySummary.featured || 0)
        },
        requestPipeline: {
          pending: Number(requestPipeline.pending || 0),
          review: Number(requestPipeline.review || 0),
          quoting: Number(requestPipeline.quoting || 0),
          quoted: Number(requestPipeline.quoted || 0),
          accepted: Number(requestPipeline.accepted || 0)
        },
        upcomingJobs: upcomingJobs.map(row => ({
          id: Number(row.id),
          status: row.status,
          scheduledAt: row.scheduled_at,
          location: row.location,
          clientName: row.client_name,
          technicianName: row.technician_name
        })),
        topServices: topServices.map(row => ({
          service: row.service,
          requests: Number(row.requests || 0),
          accepted: Number(row.accepted || 0)
        })),
        jobStatusSummary: jobStatusSummary.map(row => ({
          status: row.status,
          total: Number(row.total || 0)
        }))
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
// V2 — SESIONES ACTIVAS
// =========================================================

app.get("/api/account/sessions", requireAuth, async (req, res) => {
  try {
    await registerActiveSession(req, req.session.user.id);
    const [rows] = await pool.query(
      `SELECT id, ip_address, user_agent, created_at, last_seen_at,
              session_id = ? AS current_session
       FROM active_sessions
       WHERE user_id=?
       ORDER BY last_seen_at DESC`,
      [req.sessionID, req.session.user.id]
    );

    res.json({
      success: true,
      sessions: rows.map(row => ({
        id: row.id,
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        created_at: row.created_at,
        last_seen_at: row.last_seen_at,
        current: Boolean(row.current_session)
      }))
    });
  } catch (error) {
    logError("Error listando sesiones", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudieron obtener las sesiones." });
  }
});

app.delete("/api/account/sessions/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: "Sesión inválida." });

    const [rows] = await pool.query(
      "SELECT session_id, user_id FROM active_sessions WHERE id=? AND user_id=? LIMIT 1",
      [id, req.session.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: "Sesión no encontrada." });
    if (rows[0].session_id === req.sessionID) {
      return res.status(400).json({ success: false, error: "No podés cerrar la sesión actual desde este listado." });
    }

    await pool.query("DELETE FROM sessions WHERE session_id=?", [rows[0].session_id]);
    await pool.query("DELETE FROM active_sessions WHERE id=?", [id]);
    await writeAudit(req, "session_revoked", "session", id);
    res.json({ success: true, message: "Sesión cerrada correctamente." });
  } catch (error) {
    logError("Error revocando sesión", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo cerrar la sesión." });
  }
});

app.post("/api/account/sessions/revoke-others", requireAuth, async (req, res) => {
  try {
    await removeAllActiveSessions(req.session.user.id, req.sessionID);
    await pool.query(
      "DELETE FROM sessions WHERE session_id <> ? AND data LIKE ?",
      [req.sessionID, '%"user":{"id":' + Number(req.session.user.id) + ',%']
    );
    await writeAudit(req, "sessions_revoked_others", "user", req.session.user.id);
    res.json({ success: true, message: "Las demás sesiones fueron cerradas." });
  } catch (error) {
    logError("Error cerrando sesiones", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudieron cerrar las demás sesiones." });
  }
});

// =========================================================
// V2 — 2FA TOTP PARA ADMIN
// =========================================================

app.get("/api/account/2fa/status", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT role, totp_enabled FROM users WHERE id=? LIMIT 1", [req.session.user.id]);
    res.json({ success: true, enabled: Boolean(rows[0]?.totp_enabled), required: rows[0]?.role === "admin" });
  } catch (error) {
    res.status(500).json({ success: false, error: "No se pudo consultar 2FA." });
  }
});

app.post("/api/account/2fa/setup", requireAuth, authLimiter, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const [rows] = await pool.query("SELECT password_hash, role, totp_enabled FROM users WHERE id=? LIMIT 1", [req.session.user.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: "Usuario no encontrado." });
    if (rows[0].role !== "admin") return res.status(403).json({ success: false, error: "2FA está reservado para administradores." });
    if (rows[0].totp_enabled) return res.status(400).json({ success: false, error: "2FA ya está habilitado." });
    if (!await bcrypt.compare(currentPassword, rows[0].password_hash)) return res.status(401).json({ success: false, error: "La contraseña actual es incorrecta." });

    const secret = generateTotpSecret();
    const encrypted = encryptSecret(secret, process.env.SESSION_SECRET);
    await pool.query("UPDATE users SET totp_secret=? WHERE id=?", [encrypted, req.session.user.id]);

    const issuer = "JR Electricidad";
    const label = `${issuer}:${req.session.user.email}`;
    const otpauth = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    res.json({ success: true, secret, otpauth_uri: otpauth });
  } catch (error) {
    logError("Error preparando 2FA", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo preparar 2FA." });
  }
});

app.post("/api/account/2fa/enable", requireAuth, authLimiter, async (req, res) => {
  try {
    const code = String(req.body.code || "");
    const [rows] = await pool.query("SELECT totp_secret, totp_enabled, role FROM users WHERE id=? LIMIT 1", [req.session.user.id]);
    if (!rows.length || rows[0].role !== "admin") return res.status(403).json({ success: false, error: "Acceso no autorizado." });
    if (rows[0].totp_enabled) return res.status(400).json({ success: false, error: "2FA ya está habilitado." });
    if (!rows[0].totp_secret) return res.status(400).json({ success: false, error: "Primero generá la configuración de 2FA." });

    const secret = decryptSecret(rows[0].totp_secret, process.env.SESSION_SECRET);
    if (!verifyTotp(secret, code)) return res.status(401).json({ success: false, error: "Código 2FA inválido." });

    const backupCodes = generateBackupCodes();
    await pool.query("DELETE FROM mfa_backup_codes WHERE user_id=?", [req.session.user.id]);
    for (const backup of backupCodes) {
      await pool.query("INSERT INTO mfa_backup_codes (user_id, code_hash) VALUES (?, ?)", [req.session.user.id, hashBackupCode(backup)]);
    }
    await pool.query("UPDATE users SET totp_enabled=1 WHERE id=?", [req.session.user.id]);
    await writeAudit(req, "2fa_enabled", "user", req.session.user.id);

    res.json({ success: true, message: "2FA habilitado correctamente.", backup_codes: backupCodes });
  } catch (error) {
    logError("Error habilitando 2FA", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo habilitar 2FA." });
  }
});

app.post("/api/account/2fa/disable", requireAuth, authLimiter, async (req, res) => {
  try {
    const password = String(req.body.password || "");
    const code = String(req.body.code || "");
    const [rows] = await pool.query("SELECT password_hash, totp_secret, totp_enabled, role FROM users WHERE id=? LIMIT 1", [req.session.user.id]);
    if (!rows.length || rows[0].role !== "admin") return res.status(403).json({ success: false, error: "Acceso no autorizado." });
    if (!rows[0].totp_enabled) return res.status(400).json({ success: false, error: "2FA no está habilitado." });
    if (!await bcrypt.compare(password, rows[0].password_hash)) return res.status(401).json({ success: false, error: "La contraseña actual es incorrecta." });

    const secret = decryptSecret(rows[0].totp_secret, process.env.SESSION_SECRET);
    if (!verifyTotp(secret, code)) return res.status(401).json({ success: false, error: "Código 2FA inválido." });

    await pool.query("UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?", [req.session.user.id]);
    await pool.query("DELETE FROM mfa_backup_codes WHERE user_id=?", [req.session.user.id]);
    await writeAudit(req, "2fa_disabled", "user", req.session.user.id);
    res.json({ success: true, message: "2FA deshabilitado correctamente." });
  } catch (error) {
    logError("Error deshabilitando 2FA", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo deshabilitar 2FA." });
  }
});

app.post("/api/login/2fa", authLimiter, async (req, res) => {
  try {
    const pending = req.session.pending2fa;
    if (!pending || Date.now() - pending.createdAt > 5 * 60 * 1000) {
      return res.status(401).json({ success: false, error: "El desafío 2FA venció. Iniciá sesión nuevamente." });
    }

    const code = String(req.body.code || "").trim();
    const [rows] = await pool.query("SELECT id,name,email,role,totp_secret,totp_enabled FROM users WHERE id=? LIMIT 1", [pending.userId]);
    if (!rows.length || rows[0].role !== "admin" || !rows[0].totp_enabled) {
      return res.status(401).json({ success: false, error: "Desafío 2FA inválido." });
    }

    const secret = decryptSecret(rows[0].totp_secret, process.env.SESSION_SECRET);
    let valid = verifyTotp(secret, code);
    if (!valid && code) {
      const hash = hashBackupCode(code);
      const [codes] = await pool.query("SELECT id FROM mfa_backup_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL LIMIT 1", [pending.userId, hash]);
      if (codes.length) {
        await pool.query("UPDATE mfa_backup_codes SET used_at=NOW() WHERE id=?", [codes[0].id]);
        valid = true;
      }
    }

    if (!valid) {
      await writeAudit(req, "2fa_failed", "user", pending.userId);
      return res.status(401).json({ success: false, error: "Código 2FA inválido." });
    }

    const user = { id: rows[0].id, name: rows[0].name, email: rows[0].email, role: rows[0].role };
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.user = user;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    await registerActiveSession(req, user.id);
    await writeAudit(req, "login", "user", user.id, { mfa: true });
    res.json({ success: true, ok: true, user: cleanUser(user) });
  } catch (error) {
    logError("Error verificando 2FA", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo verificar 2FA." });
  }
});

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

  await pool.query(
    "DELETE FROM active_sessions WHERE last_seen_at < DATE_SUB(NOW(), INTERVAL 8 HOUR)"
  ).catch(error => {
    logError("No se pudieron limpiar sesiones activas vencidas", { error: error.message });
  });

  try {

    await pool.query(
      "SELECT 1"
    );


    console.log(
      "✅ MySQL conectado"
    );
	// =====================================================
// =====================================================
// FASE 8 — GESTIÓN AVANZADA DE TRABAJOS
// =====================================================

const JOB_STATUSES = [
  "pendiente_presupuesto",
  "presupuesto_enviado",
  "aceptado",
  "programado",
  "en_proceso",
  "pausado",
  "finalizado",
  "cerrado",
  "rechazado",
  "cancelado"
];

const JOB_TRANSITIONS = {
  pendiente_presupuesto:["presupuesto_enviado","rechazado","cancelado"],
  presupuesto_enviado:["aceptado","rechazado","cancelado"],
  aceptado:["programado","en_proceso","cancelado"],
  programado:["en_proceso","cancelado"],
  en_proceso:["pausado","finalizado","cancelado"],
  pausado:["en_proceso","cancelado"],
  finalizado:["cerrado"],
  cerrado:[],
  rechazado:[],
  cancelado:[]
};

const jobUpload = multer({
  storage,
  limits:{fileSize:10*1024*1024},
  fileFilter:(req,file,cb)=>{
    const allowed=[
      "image/jpeg","image/png","image/webp","image/gif",
      "application/pdf","text/plain",
      "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ];
    if(!allowed.includes(file.mimetype)) return cb(new Error("Tipo de archivo no permitido."));
    cb(null,true);
  }
});

function validateJobId(value){
  const id=Number(value);
  return Number.isInteger(id)&&id>0?id:null;
}

function validateJobStatus(value){
  const status=String(value||"").trim();
  return JOB_STATUSES.includes(status)?status:null;
}

function validateJobDateTime(value){
  if(value==null||String(value).trim()==="") return null;
  const text=String(value).trim();
  if(!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(text)) return undefined;
  return text.replace("T"," ");
}

async function recordJobHistory(req,jobId,action,oldStatus=null,newStatus=null,metadata=null,db=pool){
  await db.query(
    `INSERT INTO job_history
      (job_id,actor_user_id,action,old_status,new_status,metadata)
     VALUES (?,?,?,?,?,?)`,
    [jobId,req.session?.user?.id||null,action,oldStatus,newStatus,metadata?JSON.stringify(metadata):null]
  );
}

async function createJobNotification(type,quoteId,message,jobId,userId=null,priority="normal"){
  try {
    await createAdminNotification({
      type,
      quoteId,
      message,
      userId,
      entityType: "job",
      entityId: jobId,
      linkUrl: "/admin.html#jobsSection",
      priority
    });
  } catch(error) {
    logError("No se pudo crear notificación de trabajo",{error:error.message,quoteId,jobId,userId});
  }
}

// Lista de trabajos.
app.get("/api/admin/jobs",requireAdmin,async(req,res)=>{
  try{
    const search=String(req.query.search||"").trim();
    const status=String(req.query.status||"").trim();
    const assignedUserId=String(req.query.assigned_user_id||"").trim();
    const dateFrom=String(req.query.date_from||"").trim();
    const dateTo=String(req.query.date_to||"").trim();

    if(status&&!validateJobStatus(status)) return res.status(400).json({error:"Estado de trabajo inválido."});

    const params=[];
    let sql=`
      SELECT j.id,j.quote_id,j.status,j.started_at,j.completed_at,j.created_at,j.updated_at,
             j.assigned_user_id,j.scheduled_at,j.internal_notes,j.execution_notes,j.completion_notes,j.location,
             q.quote_number,q.issue_date,q.subtotal,q.discount,q.total,q.notes,
             qr.name AS client_name,qr.phone AS client_phone,qr.email AS client_email,
             qr.service AS requested_service,qr.description AS work_description,qr.preferred_date,
             u.name AS assigned_user_name
      FROM jobs j
      INNER JOIN quotes q ON q.id=j.quote_id
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN users u ON u.id=j.assigned_user_id
      WHERE 1=1`;

    if(search){
      const v=`%${search}%`;
      sql+=` AND (qr.name LIKE ? OR qr.phone LIKE ? OR qr.email LIKE ? OR q.quote_number LIKE ? OR qr.service LIKE ? OR qr.description LIKE ?)`;
      params.push(v,v,v,v,v,v);
    }
    if(status){sql+=" AND j.status=?";params.push(status);}
    if(assignedUserId){
      const id=Number(assignedUserId);
      if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:"Técnico inválido."});
      sql+=" AND j.assigned_user_id=?";params.push(id);
    }
    if(dateFrom){if(!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom))return res.status(400).json({error:"Fecha desde inválida."});sql+=" AND DATE(COALESCE(j.scheduled_at,j.created_at))>=?";params.push(dateFrom);}
    if(dateTo){if(!/^\d{4}-\d{2}-\d{2}$/.test(dateTo))return res.status(400).json({error:"Fecha hasta inválida."});sql+=" AND DATE(COALESCE(j.scheduled_at,j.created_at))<=?";params.push(dateTo);}
    sql+=" ORDER BY FIELD(j.status,'programado','en_proceso','pausado','finalizado','aceptado','pendiente_presupuesto','presupuesto_enviado','cerrado','rechazado','cancelado'),COALESCE(j.scheduled_at,j.created_at) ASC,j.id DESC";

    const [jobs]=await pool.query(sql,params);
    res.json({success:true,jobs});
  }catch(error){
    logError("Error obteniendo trabajos V2",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron obtener los trabajos."});
  }
});

// Detalle completo.
app.get("/api/admin/jobs/:id(\\d+)",requireAdmin,async(req,res)=>{
  try{
    const id=validateJobId(req.params.id);
    if(!id)return res.status(400).json({error:"ID de trabajo inválido."});
    const [rows]=await pool.query(`
      SELECT j.*,q.quote_number,q.issue_date,q.expiration_date,q.notes,q.subtotal,q.discount,q.total,
             qr.name AS client_name,qr.phone AS client_phone,qr.email AS client_email,
             qr.service AS requested_service,qr.description AS work_description,qr.preferred_date,
             c.address AS client_address,c.locality AS client_locality,u.name AS assigned_user_name
      FROM jobs j
      INNER JOIN quotes q ON q.id=j.quote_id
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN clients c ON c.id=qr.client_id
      LEFT JOIN users u ON u.id=j.assigned_user_id
      WHERE j.id=? LIMIT 1`,[id]);
    if(!rows.length)return res.status(404).json({error:"Trabajo no encontrado."});

    const [items]=await pool.query("SELECT id,description,quantity,unit,unit_price,total FROM quote_items WHERE quote_id=? ORDER BY id",[rows[0].quote_id]);
    const [history]=await pool.query(`
      SELECT h.*,u.name AS actor_name FROM job_history h
      LEFT JOIN users u ON u.id=h.actor_user_id
      WHERE h.job_id=? ORDER BY h.created_at DESC,h.id DESC`,[id]);
    const [attachments]=await pool.query(`
      SELECT id,original_name,url,mime_type,size_bytes,category,created_at
      FROM job_attachments WHERE job_id=? ORDER BY created_at DESC,id DESC`,[id]);

    res.json({success:true,job:{...rows[0],items,history,attachments}});
  }catch(error){
    logError("Error obteniendo detalle de trabajo",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el trabajo."});
  }
});

// Técnicos disponibles.
app.get("/api/admin/jobs/assignees",requireAdmin,async(req,res)=>{
  try{
    const [rows]=await pool.query("SELECT id,name,email FROM users ORDER BY name");
    res.json({success:true,users:rows});
  }catch(error){res.status(500).json({error:"No se pudieron obtener los técnicos."});}
});

// Actualizar datos operativos.
app.put("/api/admin/jobs/:id(\\d+)",requireAdmin,adminMutationLimiter,async(req,res)=>{
  try{
    const id=validateJobId(req.params.id);
    if(!id)return res.status(400).json({error:"ID de trabajo inválido."});
    const [rows]=await pool.query("SELECT * FROM jobs WHERE id=? LIMIT 1",[id]);
    if(!rows.length)return res.status(404).json({error:"Trabajo no encontrado."});
    const current=rows[0];
    if(["cerrado","cancelado","rechazado"].includes(current.status))return res.status(409).json({error:"Este trabajo ya está cerrado o cancelado."});

    let assigned=current.assigned_user_id;
    if(req.body.assigned_user_id!==undefined){
      assigned=req.body.assigned_user_id===""||req.body.assigned_user_id===null?null:Number(req.body.assigned_user_id);
      if(assigned!==null&&(!Number.isInteger(assigned)||assigned<=0))return res.status(400).json({error:"Técnico inválido."});
      if(assigned!==null){const [u]=await pool.query("SELECT id FROM users WHERE id=? LIMIT 1",[assigned]);if(!u.length)return res.status(400).json({error:"El técnico no existe."});}
    }
    const scheduled=req.body.scheduled_at===undefined?current.scheduled_at:validateJobDateTime(req.body.scheduled_at);
    if(scheduled===undefined)return res.status(400).json({error:"Fecha programada inválida."});
    const fields={
      assigned_user_id:assigned,
      scheduled_at:scheduled,
      internal_notes:req.body.internal_notes===undefined?current.internal_notes:String(req.body.internal_notes||"").slice(0,10000),
      execution_notes:req.body.execution_notes===undefined?current.execution_notes:String(req.body.execution_notes||"").slice(0,10000),
      location:req.body.location===undefined?current.location:String(req.body.location||"").slice(0,255)
    };
    await pool.query(`UPDATE jobs SET assigned_user_id=?,scheduled_at=?,internal_notes=?,execution_notes=?,location=? WHERE id=?`,
      [fields.assigned_user_id,fields.scheduled_at,fields.internal_notes,fields.execution_notes,fields.location,id]);
    await recordJobHistory(req,id,"job_updated",current.status,current.status,{changes:fields});
    await writeAudit(req,"job_updated","job",id,fields);

    if (String(current.assigned_user_id || "") !== String(fields.assigned_user_id || "")) {
      if (fields.assigned_user_id) {
        await createJobNotification(
          "job_assigned",
          current.quote_id,
          `El trabajo #${id} fue asignado a tu usuario.`,
          id,
          fields.assigned_user_id,
          "high"
        );
      } else {
        await createJobNotification(
          "job_status_changed",
          current.quote_id,
          `El trabajo #${id} quedó sin técnico asignado.`,
          id,
          null,
          "normal"
        );
      }
    }

    if (String(current.scheduled_at || "") !== String(fields.scheduled_at || "") && fields.scheduled_at) {
      await createJobNotification(
        "job_scheduled",
        current.quote_id,
        `El trabajo #${id} fue programado para ${new Date(fields.scheduled_at).toLocaleString("es-AR")}.`,
        id,
        fields.assigned_user_id || null,
        "high"
      );
    }
      await notifyJobCustomer(id, current.status, fields.scheduled_at);
      await notifyJobWhatsApp(id, current.status, fields.scheduled_at);

    res.json({success:true,message:"Trabajo actualizado correctamente."});
  }catch(error){
    logError("Error actualizando trabajo",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el trabajo."});
  }
});

// Cambiar estado con transiciones controladas.
app.put("/api/admin/jobs/:id(\\d+)/status",requireAdmin,adminMutationLimiter,async(req,res)=>{
  const connection=await pool.getConnection();
  try{
    const id=validateJobId(req.params.id);
    const next=validateJobStatus(req.body?.status);
    if(!id||!next){connection.release();return res.status(400).json({error:"ID o estado de trabajo inválido."});}
    const [rows]=await connection.query("SELECT * FROM jobs WHERE id=? LIMIT 1 FOR UPDATE",[id]);
    if(!rows.length){connection.release();return res.status(404).json({error:"Trabajo no encontrado."});}
    const job=rows[0];
    if(job.status===next){connection.release();return res.json({success:true,status:next,message:"El trabajo ya se encuentra en ese estado."});}
    if(!(JOB_TRANSITIONS[job.status]||[]).includes(next)){
      connection.release();return res.status(409).json({error:"No se puede cambiar a ese estado desde el estado actual."});
    }

    const nowFields=[];
    const values=[];
    if(next==="en_proceso"){
      nowFields.push("started_at=COALESCE(started_at,NOW())","started_by_user_id=?");values.push(req.session.user.id);
    }
    if(next==="finalizado"){
      nowFields.push("completed_at=COALESCE(completed_at,NOW())","completed_by_user_id=?");values.push(req.session.user.id);
    }
    if(next==="cerrado" && !job.completed_at){
      nowFields.push("completed_at=NOW()","completed_by_user_id=?");values.push(req.session.user.id);
    }
    nowFields.push("status=?");values.push(next,id);
    await connection.query(`UPDATE jobs SET ${nowFields.join(",")} WHERE id=?`,values);
    await recordJobHistory(req,id,"status_changed",job.status,next,null,connection);
    await connection.commit();

    const messages={
      programado:"Trabajo programado correctamente.",
      en_proceso:"Trabajo iniciado correctamente.",
      pausado:"Trabajo pausado correctamente.",
      finalizado:"Trabajo marcado como finalizado.",
      cerrado:"Trabajo cerrado correctamente.",
      cancelado:"Trabajo cancelado correctamente."
    };
    const notificationType =
      next === "cerrado" ? "job_closed" :
      next === "finalizado" ? "job_finished" :
      next === "en_proceso" ? "job_started" :
      "job_status_changed";
    const notificationPriority =
      ["finalizado","cerrado","en_proceso"].includes(next) ? "high" :
      ["programado","pausado"].includes(next) ? "normal" : "low";
    await createJobNotification(
      notificationType,
      job.quote_id,
      `El trabajo #${id} pasó de ${job.status} a ${next}.`,
      id,
      job.assigned_user_id || null,
      notificationPriority
    );
    await notifyJobCustomer(id, next, next === "programado" ? job.scheduled_at : null);
    await notifyJobWhatsApp(id, next, next === "programado" ? job.scheduled_at : null);
    await writeAudit(req,"job_status_changed","job",id,{old_status:job.status,new_status:next});
    res.json({success:true,status:next,message:messages[next]||"Estado actualizado correctamente."});
  }catch(error){
    await connection.rollback().catch(()=>{});
    logError("Error actualizando estado de trabajo",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el estado del trabajo."});
  }finally{connection.release();}
});

// Historial.
app.get("/api/admin/jobs/:id(\\d+)/history",requireAdmin,async(req,res)=>{
  try{
    const id=validateJobId(req.params.id);if(!id)return res.status(400).json({error:"ID inválido."});
    const [rows]=await pool.query(`
      SELECT h.*,u.name AS actor_name FROM job_history h
      LEFT JOIN users u ON u.id=h.actor_user_id
      WHERE h.job_id=? ORDER BY h.created_at DESC,h.id DESC`,[id]);
    res.json({success:true,history:rows});
  }catch(error){res.status(500).json({error:"No se pudo obtener el historial."});}
});

// Subir evidencia/documento.
app.post("/api/admin/jobs/:id(\\d+)/attachments",requireAdmin,jobUpload.single("file"),async(req,res)=>{
  try{
    const id=validateJobId(req.params.id);if(!id)return res.status(400).json({error:"ID inválido."});
    const [rows]=await pool.query("SELECT id FROM jobs WHERE id=? LIMIT 1",[id]);
    if(!rows.length){if(req.file)fs.unlink(req.file.path,()=>{});return res.status(404).json({error:"Trabajo no encontrado."});}
    if(!req.file)return res.status(400).json({error:"No se recibió ningún archivo."});
    const allowedCategories=["inicio","proceso","final","documento","otro"];
    const category=allowedCategories.includes(String(req.body.category||""))?String(req.body.category):"otro";
    const url="/uploads/"+req.file.filename;
    const [result]=await pool.query(`
      INSERT INTO job_attachments
      (job_id,uploaded_by_user_id,original_name,stored_name,url,mime_type,size_bytes,category)
      VALUES (?,?,?,?,?,?,?,?)`,
      [id,req.session.user.id,req.file.originalname,req.file.filename,url,req.file.mimetype,req.file.size,category]
    );
    await recordJobHistory(req,id,"attachment_added",null,null,{attachment_id:result.insertId,category,name:req.file.originalname});
    await writeAudit(req,"job_attachment_added","job",id,{attachment_id:result.insertId,category});
    res.status(201).json({success:true,id:result.insertId,url,message:"Archivo adjuntado correctamente."});
  }catch(error){
    if(req.file)fs.unlink(req.file.path,()=>{});
    logError("Error subiendo evidencia de trabajo",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo adjuntar el archivo."});
  }
});

// Eliminar evidencia.
app.delete("/api/admin/jobs/:id(\\d+)/attachments/:attachmentId(\\d+)",requireAdmin,adminMutationLimiter,async(req,res)=>{
  try{
    const jobId=validateJobId(req.params.id),attachmentId=validateJobId(req.params.attachmentId);
    if(!jobId||!attachmentId)return res.status(400).json({error:"ID inválido."});
    const [rows]=await pool.query("SELECT * FROM job_attachments WHERE id=? AND job_id=? LIMIT 1",[attachmentId,jobId]);
    if(!rows.length)return res.status(404).json({error:"Archivo no encontrado."});
    const [[publishedGallery]]=await pool.query(
      "SELECT id FROM gallery WHERE source_job_attachment_id=? LIMIT 1",
      [attachmentId]
    );
    if(publishedGallery){
      return res.status(409).json({
        error:"Esta evidencia está publicada en la galería. Eliminá primero la publicación de galería."
      });
    }
    await pool.query("DELETE FROM job_attachments WHERE id=?",[attachmentId]);
    if(rows[0].stored_name)fs.unlink(path.join(uploadsDir,rows[0].stored_name),()=>{});
    await recordJobHistory(req,jobId,"attachment_deleted",null,null,{attachment_id:attachmentId});
    await writeAudit(req,"job_attachment_deleted","job",jobId,{attachment_id:attachmentId});
    res.json({success:true,message:"Archivo eliminado."});
  }catch(error){res.status(500).json({error:"No se pudo eliminar el archivo."});}
});

// Historial cerrado con filtros.
app.get("/api/admin/jobs-history",requireAdmin,async(req,res)=>{
  try{
    const search=String(req.query.search||"").trim();
    const dateFrom=String(req.query.date_from||"").trim();
    const dateTo=String(req.query.date_to||"").trim();
    const params=[];
    let sql=`
      SELECT j.id,j.quote_id,j.status,j.started_at,j.completed_at,j.created_at,j.updated_at,
             j.scheduled_at,j.location,j.assigned_user_id,u.name AS assigned_user_name,
             q.quote_number,q.issue_date,q.subtotal,q.discount,q.total,q.notes,
             qr.name AS client_name,qr.phone AS client_phone,qr.email AS client_email,
             qr.service AS requested_service,qr.description AS work_description
      FROM jobs j
      INNER JOIN quotes q ON q.id=j.quote_id
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN users u ON u.id=j.assigned_user_id
      WHERE j.status IN ('cerrado','finalizado')`;
    if(search){const v=`%${search}%`;sql+=" AND (qr.name LIKE ? OR qr.phone LIKE ? OR qr.email LIKE ? OR q.quote_number LIKE ? OR qr.service LIKE ? OR qr.description LIKE ?)";params.push(v,v,v,v,v,v);}
    if(dateFrom){if(!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom))return res.status(400).json({error:"Fecha desde inválida."});sql+=" AND DATE(COALESCE(j.completed_at,j.created_at))>=?";params.push(dateFrom);}
    if(dateTo){if(!/^\d{4}-\d{2}-\d{2}$/.test(dateTo))return res.status(400).json({error:"Fecha hasta inválida."});sql+=" AND DATE(COALESCE(j.completed_at,j.created_at))<=?";params.push(dateTo);}
    sql+=" ORDER BY COALESCE(j.completed_at,j.created_at) DESC,j.id DESC";
    const [jobs]=await pool.query(sql,params);
    res.json({success:true,jobs,summary:{count:jobs.length,total:jobs.reduce((sum,row)=>sum+Number(row.total||0),0)}});
  }catch(error){logError("Error obteniendo historial de trabajos",{requestId:req.requestId,error:error.message});res.status(500).json({error:"No se pudo obtener el historial."});}
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
// SOLICITUDES - ADMIN V2
// ========================================

const REQUEST_STATUSES = [
  "nueva",
  "en_revision",
  "presupuestando",
  "presupuestada",
  "aceptada",
  "programada",
  "en_trabajo",
  "finalizada",
  "cerrada"
];

const REQUEST_PRIORITIES = [
  "baja",
  "normal",
  "alta",
  "urgente"
];

function validateRequestId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateRequestStatus(status) {
  return REQUEST_STATUSES.includes(String(status || "").trim());
}

function validateRequestPriority(priority) {
  return REQUEST_PRIORITIES.includes(String(priority || "").trim());
}

function validateOptionalDateTime(value) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text) &&
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text)) {
    return undefined;
  }
  return text.replace("T", " ");
}

async function recordRequestHistory(req, requestId, action, oldStatus, newStatus, metadata = null) {
  await pool.query(
    `INSERT INTO quote_request_history
      (quote_request_id, actor_user_id, action, old_status, new_status, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      requestId,
      req.session?.user?.id || null,
      action,
      oldStatus || null,
      newStatus || null,
      metadata ? JSON.stringify(metadata) : null
    ]
  );
}

async function notifyRequestWhatsApp(request, message, entityType="quote_request") {
  try {
    const settings=await whatsappBusinessEnabled();
    if(!settings?.whatsapp_auto_notifications || !request?.whatsapp && !request?.phone) return false;
    const phone=request.whatsapp || request.phone;
    await queueWhatsApp({
      to:phone,
      message,
      requestId:null,
      entityType,
      entityId:request.id
    });
    return true;
  } catch(error) {
    logError("No se pudo encolar WhatsApp de cliente",{requestId:null,error:error.message,entityId:request?.id});
    return false;
  }
}

async function notifyRequestCustomer(request, subject, message) {
  if (!request?.email) return false;
  try {
    const template = String(subject || "").toLowerCase().includes("recibida")
      ? "request_received"
      : "request_status";
    await queueEmail({
      to: request.email,
      subject,
      template,
      data: {
        name: request.name,
        requestId: request.id,
        status: request.status,
        service: request.service,
        message
      },
      requestId: null
    });
    return true;
  } catch (error) {
    logError("No se pudo encolar notificación al cliente", {
      requestId: null,
      error: error.message,
      quoteRequestId: request.id
    });
    return false;
  }
}

async function notifyJobWhatsApp(jobId, status, scheduledAt = null) {
  try {
    const settings=await whatsappBusinessEnabled();
    if(!settings?.whatsapp_auto_notifications) return false;
    const [rows]=await pool.query(
      `SELECT j.id,qr.phone,qr.whatsapp,qr.name
       FROM jobs j
       INNER JOIN quotes q ON q.id=j.quote_id
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE j.id=? LIMIT 1`,[jobId]
    );
    const job=rows[0];
    const phone=job?.whatsapp || job?.phone;
    if(!phone) return false;
    let message=`JR Electricidad: el trabajo #${jobId} está en estado ${String(status).replace(/_/g," ")}.`;
    if(scheduledAt) message+=` Programado para ${new Date(scheduledAt).toLocaleString("es-AR").replace(",", "")}.`;
    await queueWhatsApp({to:phone,message,entityType:"job",entityId:jobId});
    return true;
  } catch(error) {
    logError("No se pudo encolar WhatsApp del trabajo",{requestId:null,error:error.message,jobId});
    return false;
  }
}

async function notifyJobCustomer(jobId, status, scheduledAt = null) {
  try {
    const [rows] = await pool.query(
      `SELECT j.id,j.status,qr.name,qr.email
       FROM jobs j
       INNER JOIN quotes q ON q.id=j.quote_id
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE j.id=? LIMIT 1`,
      [jobId]
    );
    const job=rows[0];
    if(!job?.email) return false;
    await queueEmail({
      to: job.email,
      subject: "Actualización de trabajo #" + jobId + " - JR Electricidad",
      template: "job_update",
      data: {
        name: job.name,
        jobId,
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toLocaleString("es-AR") : null
      }
    });
    return true;
  } catch(error) {
    logError("No se pudo encolar actualización del trabajo al cliente", {
      requestId:null,
      jobId,
      error:error.message
    });
    return false;
  }
}

// Listar solicitudes con búsqueda, estado, prioridad, técnico y fechas.
app.get("/api/admin/quote-requests", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const priority = String(req.query.priority || "").trim();
    const assignedUserId = String(req.query.assigned_user_id || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    if (status && !validateRequestStatus(status)) {
      return res.status(400).json({ error: "Estado de solicitud inválido." });
    }
    if (priority && !validateRequestPriority(priority)) {
      return res.status(400).json({ error: "Prioridad inválida." });
    }

    const params = [];
    let sql = `
      SELECT
        qr.id, qr.client_id, qr.name, qr.phone, qr.email, qr.service,
        qr.description, qr.preferred_date, qr.image_url, qr.status,
        qr.priority, qr.assigned_user_id, qr.scheduled_at,
        qr.internal_notes, qr.closed_at, qr.created_at, qr.updated_at,
        u.name AS assigned_user_name,
        c.locality AS client_locality,
        (SELECT COUNT(*) FROM quote_request_attachments a WHERE a.quote_request_id=qr.id) AS attachments_count,
        (SELECT COUNT(*) FROM quote_request_history h WHERE h.quote_request_id=qr.id) AS history_count,
        q.id AS quote_id,
        q.quote_number,
        j.id AS job_id,
        j.status AS job_status
      FROM quote_requests qr
      LEFT JOIN users u ON u.id=qr.assigned_user_id
      LEFT JOIN clients c ON c.id=qr.client_id
      LEFT JOIN quotes q ON q.quote_request_id=qr.id
      LEFT JOIN jobs j ON j.quote_id=q.id
      WHERE 1=1
    `;

    if (search) {
      const value = `%${search}%`;
      sql += ` AND (
        qr.name LIKE ? OR qr.phone LIKE ? OR qr.email LIKE ? OR
        qr.service LIKE ? OR qr.description LIKE ? OR c.locality LIKE ?
      )`;
      params.push(value, value, value, value, value, value);
    }

    if (status) {
      sql += " AND qr.status=?";
      params.push(status);
    }

    if (priority) {
      sql += " AND qr.priority=?";
      params.push(priority);
    }

    if (assignedUserId) {
      const id = Number(assignedUserId);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Técnico asignado inválido." });
      }
      sql += " AND qr.assigned_user_id=?";
      params.push(id);
    }

    if (dateFrom) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
        return res.status(400).json({ error: "La fecha desde no es válida." });
      }
      sql += " AND DATE(qr.created_at)>=?";
      params.push(dateFrom);
    }

    if (dateTo) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
        return res.status(400).json({ error: "La fecha hasta no es válida." });
      }
      sql += " AND DATE(qr.created_at)<=?";
      params.push(dateTo);
    }

    sql += " ORDER BY FIELD(qr.priority,'urgente','alta','normal','baja'), qr.created_at DESC, qr.id DESC";

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo solicitudes V2", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener las solicitudes." });
  }
});

// Obtener una solicitud completa.
app.get("/api/admin/quote-requests/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID de solicitud inválido." });

    const [rows] = await pool.query(
      `SELECT
        qr.*,
        u.name AS assigned_user_name,
        c.locality AS client_locality,
        c.address AS client_address,
        q.id AS quote_id,
        q.quote_number,
        j.id AS job_id,
        j.status AS job_status
       FROM quote_requests qr
       LEFT JOIN users u ON u.id=qr.assigned_user_id
       LEFT JOIN clients c ON c.id=qr.client_id
       LEFT JOIN quotes q ON q.quote_request_id=qr.id
       LEFT JOIN jobs j ON j.quote_id=q.id
       WHERE qr.id=? LIMIT 1`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: "Solicitud no encontrada." });

    const [history] = await pool.query(
      `SELECT h.*, u.name AS actor_name
       FROM quote_request_history h
       LEFT JOIN users u ON u.id=h.actor_user_id
       WHERE h.quote_request_id=?
       ORDER BY h.created_at DESC, h.id DESC`,
      [id]
    );

    const [attachments] = await pool.query(
      `SELECT id, original_name, url, mime_type, size_bytes, created_at
       FROM quote_request_attachments
       WHERE quote_request_id=?
       ORDER BY created_at DESC, id DESC`,
      [id]
    );

    res.json({
      ...rows[0],
      history,
      attachments
    });
  } catch (error) {
    logError("Error obteniendo detalle de solicitud", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo obtener la solicitud." });
  }
});

// Actualizar estado/prioridad/técnico/agenda/notas.
app.patch("/api/admin/quote-requests/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = validateRequestId(req.params.id);
    if (!id) {
      connection.release();
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    const [existingRows] = await connection.query(
      "SELECT * FROM quote_requests WHERE id=? LIMIT 1 FOR UPDATE",
      [id]
    );

    if (!existingRows.length) {
      connection.release();
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const current = existingRows[0];
    const body = req.body || {};

    let status = body.status === undefined ? current.status : String(body.status || "").trim();
    let priority = body.priority === undefined ? current.priority : String(body.priority || "").trim();

    if (!validateRequestStatus(status)) {
      connection.release();
      return res.status(400).json({ error: "Estado de solicitud inválido." });
    }

    if (!validateRequestPriority(priority)) {
      connection.release();
      return res.status(400).json({ error: "Prioridad inválida." });
    }

    let assignedUserId = current.assigned_user_id;
    if (body.assigned_user_id !== undefined && body.assigned_user_id !== null && String(body.assigned_user_id).trim() !== "") {
      assignedUserId = Number(body.assigned_user_id);
      if (!Number.isInteger(assignedUserId) || assignedUserId <= 0) {
        connection.release();
        return res.status(400).json({ error: "Técnico asignado inválido." });
      }
      const [userRows] = await connection.query("SELECT id FROM users WHERE id=? LIMIT 1", [assignedUserId]);
      if (!userRows.length) {
        connection.release();
        return res.status(400).json({ error: "El técnico asignado no existe." });
      }
    } else if (body.assigned_user_id === null || String(body.assigned_user_id || "").trim() === "") {
      assignedUserId = null;
    }

    const scheduledAt = body.scheduled_at === undefined
      ? current.scheduled_at
      : validateOptionalDateTime(body.scheduled_at);

    if (scheduledAt === undefined) {
      connection.release();
      return res.status(400).json({ error: "La fecha programada no es válida." });
    }

    const internalNotes = body.internal_notes === undefined
      ? String(current.internal_notes || "")
      : String(body.internal_notes || "").trim();

    if (internalNotes.length > 10000) {
      connection.release();
      return res.status(400).json({ error: "Las notas internas no pueden superar 10000 caracteres." });
    }

    const closedAt = status === "cerrada" || status === "finalizada"
      ? (current.closed_at || new Date())
      : null;

    await connection.beginTransaction();

    await connection.query(
      `UPDATE quote_requests
       SET status=?, priority=?, assigned_user_id=?, scheduled_at=?, internal_notes=?, closed_at=?
       WHERE id=?`,
      [status, priority, assignedUserId, scheduledAt, internalNotes || null, closedAt, id]
    );

    if (
      String(current.status) !== status ||
      String(current.priority || "normal") !== priority ||
      Number(current.assigned_user_id || 0) !== Number(assignedUserId || 0) ||
      String(current.scheduled_at || "") !== String(scheduledAt || "") ||
      String(current.internal_notes || "") !== internalNotes
    ) {
      await connection.query(
        `INSERT INTO quote_request_history
          (quote_request_id, actor_user_id, action, old_status, new_status, metadata)
         VALUES (?, ?, 'request_updated', ?, ?, ?)`,
        [
          id,
          req.session.user.id,
          current.status,
          status,
          JSON.stringify({
            priority,
            assigned_user_id: assignedUserId,
            scheduled_at: scheduledAt,
            internal_notes_changed: String(current.internal_notes || "") !== internalNotes
          })
        ]
      );
    }

    await connection.commit();
    connection.release();

    await writeAudit(req, "request_updated", "quote_request", id, {
      status,
      priority,
      assigned_user_id: assignedUserId,
      scheduled_at: scheduledAt
    });

    if (String(current.status) !== status) {
      await createAdminNotification({
        type: "quote_request_status",
        message: `La solicitud #${id} cambió de "${current.status}" a "${status}".`,
        entityType: "quote_request",
        entityId: id,
        linkUrl: "/admin.html#quoteRequestsSection",
        priority: ["urgente","alta"].includes(String(priority)) ? "high" : "normal"
      }).catch(() => {});

      const [requestRows] = await pool.query(
        "SELECT id,name,email,phone,whatsapp,service,status FROM quote_requests WHERE id=? LIMIT 1",
        [id]
      );
      if (requestRows.length) {
        await notifyRequestCustomer(
          requestRows[0],
          `Actualización de tu solicitud #${id} - JR Electricidad`,
          `El estado de tu solicitud cambió a: ${status.replace(/_/g, " ")}.`
        );
        await notifyRequestWhatsApp(
          requestRows[0],
          `JR Electricidad: tu solicitud #${id} cambió a ${status.replace(/_/g, " ")}.`
        );
      }
    }

    res.json({ success: true, message: "Solicitud actualizada correctamente." });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error actualizando solicitud V2", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo actualizar la solicitud." });
  }
});

// Compatibilidad V1 para cambio de estado.
app.patch("/api/admin/quote-requests/:id(\\d+)/status", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    const statusMap = {
      pendiente: "nueva",
      contactado: "en_revision",
      presupuestado: "presupuestada",
      cerrado: "cerrada"
    };
    const incoming = String(req.body.status || "").trim();
    const status = statusMap[incoming] || incoming;

    if (!id || !validateRequestStatus(status)) {
      return res.status(400).json({ error: "Estado de solicitud inválido." });
    }

    const [currentRows] = await pool.query("SELECT status FROM quote_requests WHERE id=? LIMIT 1", [id]);
    if (!currentRows.length) return res.status(404).json({ error: "Solicitud no encontrada." });

    await pool.query("UPDATE quote_requests SET status=?, closed_at=? WHERE id=?",
      [status, status === "cerrada" ? new Date() : null, id]);

    await pool.query(
      `INSERT INTO quote_request_history
        (quote_request_id, actor_user_id, action, old_status, new_status)
       VALUES (?, ?, 'status_changed', ?, ?)`,
      [id, req.session.user.id, currentRows[0].status, status]
    );

    await writeAudit(req, "request_status_changed", "quote_request", id, {
      old_status: currentRows[0].status,
      new_status: status
    });

    await createAdminNotification({
      type: "quote_request_status",
      message: `La solicitud #${id} cambió al estado "${status}".`,
      entityType: "quote_request",
      entityId: id,
      linkUrl: "/admin.html#quoteRequestsSection",
      priority: "normal"
    }).catch(() => {});

    res.json({ success: true, message: "Estado de la solicitud actualizado.", status });
  } catch (error) {
    logError("Error actualizando estado de solicitud", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo actualizar el estado." });
  }
});

// Historial independiente.
app.get("/api/admin/quote-requests/:id(\\d+)/history", requireAdmin, async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID de solicitud inválido." });

    const [rows] = await pool.query(
      `SELECT h.id,h.action,h.old_status,h.new_status,h.metadata,h.created_at,u.name AS actor_name
       FROM quote_request_history h
       LEFT JOIN users u ON u.id=h.actor_user_id
       WHERE h.quote_request_id=?
       ORDER BY h.created_at DESC,h.id DESC`,
      [id]
    );
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo historial de solicitud", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo obtener el historial." });
  }
});

// Técnicos disponibles.
app.get("/api/admin/quote-requests/assignees", requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id,name,email,role FROM users ORDER BY name ASC"
    );
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo técnicos", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener los técnicos." });
  }
});

// Adjuntar imágenes/documentos.
const requestAttachmentsDir = path.join(uploadsDir, "requests");
if (!fs.existsSync(requestAttachmentsDir)) fs.mkdirSync(requestAttachmentsDir, { recursive: true });

const requestAttachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, requestAttachmentsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, Date.now() + "-" + crypto.randomBytes(10).toString("hex") + ext);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain"
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Tipo de archivo no permitido."));
    }
    cb(null, true);
  }
});

app.post("/api/admin/quote-requests/:id(\\d+)/attachments", requireAdmin, requestAttachmentUpload.single("file"), async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    if (!id) {
      if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    if (!req.file) return res.status(400).json({ error: "Seleccioná un archivo." });

    const [rows] = await pool.query("SELECT id FROM quote_requests WHERE id=? LIMIT 1", [id]);
    if (!rows.length) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const url = "/uploads/requests/" + req.file.filename;

    const [result] = await pool.query(
      `INSERT INTO quote_request_attachments
        (quote_request_id, uploaded_by_user_id, original_name, stored_name, url, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.session.user.id,
        String(req.file.originalname || "").slice(0, 255),
        req.file.filename,
        url,
        req.file.mimetype,
        Number(req.file.size || 0)
      ]
    );

    await recordRequestHistory(req, id, "attachment_added", null, null, {
      attachment_id: result.insertId,
      original_name: req.file.originalname
    });

    await writeAudit(req, "request_attachment_added", "quote_request", id, {
      attachment_id: result.insertId,
      original_name: req.file.originalname
    });

    res.status(201).json({
      success: true,
      attachment: {
        id: result.insertId,
        original_name: req.file.originalname,
        url,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size
      }
    });
  } catch (error) {
    if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
    logError("Error adjuntando archivo a solicitud", { requestId: req.requestId, error: error.message });
    res.status(400).json({ error: error.message || "No se pudo adjuntar el archivo." });
  }
});

app.delete("/api/admin/quote-requests/:id(\\d+)/attachments/:attachmentId(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    const attachmentId = validateRequestId(req.params.attachmentId);
    if (!id || !attachmentId) return res.status(400).json({ error: "ID de solicitud o archivo inválido." });

    const [rows] = await pool.query(
      "SELECT * FROM quote_request_attachments WHERE id=? AND quote_request_id=? LIMIT 1",
      [attachmentId, id]
    );
    if (!rows.length) return res.status(404).json({ error: "Archivo no encontrado." });

    const filePath = path.join(requestAttachmentsDir, rows[0].stored_name);
    await fs.promises.unlink(filePath).catch(() => {});
    await pool.query("DELETE FROM quote_request_attachments WHERE id=?", [attachmentId]);

    await recordRequestHistory(req, id, "attachment_deleted", null, null, {
      attachment_id: attachmentId,
      original_name: rows[0].original_name
    });

    await writeAudit(req, "request_attachment_deleted", "quote_request", id, {
      attachment_id: attachmentId
    });

    res.json({ success: true, message: "Archivo eliminado." });
  } catch (error) {
    logError("Error eliminando archivo de solicitud", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo eliminar el archivo." });
  }
});

// Convertir solicitud a presupuesto borrador.
app.post("/api/admin/quote-requests/:id(\\d+)/convert-to-quote", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = validateRequestId(req.params.id);
    if (!id) {
      connection.release();
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    await connection.beginTransaction();

    const [requestRows] = await connection.query(
      "SELECT * FROM quote_requests WHERE id=? LIMIT 1 FOR UPDATE",
      [id]
    );
    if (!requestRows.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const request = requestRows[0];

    const [existingQuotes] = await connection.query(
      "SELECT id,quote_number,status FROM quotes WHERE quote_request_id=? ORDER BY id DESC LIMIT 1",
      [id]
    );

    if (existingQuotes.length) {
      await connection.commit();
      connection.release();
      return res.json({
        success: true,
        already_exists: true,
        quote_id: existingQuotes[0].id,
        quote_number: existingQuotes[0].quote_number,
        status: existingQuotes[0].status
      });
    }

    const quoteNumber = `PR-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${id}`;
    const accessToken = crypto.randomBytes(24).toString("hex");

    const [quoteResult] = await connection.query(
      `INSERT INTO quotes
        (quote_request_id, quote_number, access_token, issue_date, expiration_date, notes, status, subtotal, discount, total)
       VALUES (?, ?, ?, CURDATE(), NULL, ?, 'borrador', 0, 0, 0)`,
      [id, quoteNumber, accessToken, request.internal_notes || request.description || ""]
    );

    await connection.query(
      `INSERT INTO quote_items
        (quote_id, description, quantity, unit, unit_price, total)
       VALUES (?, ?, 1, 'global', 0, 0)`,
      [quoteResult.insertId, request.service || request.description || "Trabajo solicitado"]
    );

    const newStatus = request.status === "nueva" || request.status === "en_revision" || request.status === "presupuestando"
      ? "presupuestada"
      : request.status;

    await connection.query(
      "UPDATE quote_requests SET status=? WHERE id=?",
      [newStatus, id]
    );

    await connection.query(
      `INSERT INTO quote_request_history
        (quote_request_id, actor_user_id, action, old_status, new_status, metadata)
       VALUES (?, ?, 'converted_to_quote', ?, ?, ?)`,
      [id, req.session.user.id, request.status, newStatus, JSON.stringify({ quote_id: quoteResult.insertId })]
    );

    await connection.commit();
    connection.release();

    await writeAudit(req, "request_converted_to_quote", "quote_request", id, {
      quote_id: quoteResult.insertId
    });

    res.status(201).json({
      success: true,
      quote_id: quoteResult.insertId,
      quote_number: quoteNumber,
      status: "borrador"
    });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error convirtiendo solicitud a presupuesto", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo convertir la solicitud en presupuesto." });
  }
});

// Convertir solicitud a trabajo. Si no existe presupuesto, crea uno borrador primero.
app.post("/api/admin/quote-requests/:id(\\d+)/convert-to-job", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = validateRequestId(req.params.id);
    if (!id) {
      connection.release();
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    await connection.beginTransaction();

    const [requestRows] = await connection.query(
      "SELECT * FROM quote_requests WHERE id=? LIMIT 1 FOR UPDATE",
      [id]
    );
    if (!requestRows.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const request = requestRows[0];

    const [quoteRows] = await connection.query(
      "SELECT id,quote_number FROM quotes WHERE quote_request_id=? ORDER BY id DESC LIMIT 1",
      [id]
    );

    let quoteId;
    let quoteNumber;

    if (quoteRows.length) {
      quoteId = quoteRows[0].id;
      quoteNumber = quoteRows[0].quote_number;
    } else {
      quoteNumber = `PR-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${id}`;
      const accessToken = crypto.randomBytes(24).toString("hex");

      const [quoteResult] = await connection.query(
        `INSERT INTO quotes
          (quote_request_id, quote_number, access_token, issue_date, expiration_date, notes, status, subtotal, discount, total)
         VALUES (?, ?, ?, CURDATE(), NULL, ?, 'borrador', 0, 0, 0)`,
        [id, quoteNumber, accessToken, request.internal_notes || request.description || ""]
      );

      quoteId = quoteResult.insertId;

      await connection.query(
        `INSERT INTO quote_items
          (quote_id, description, quantity, unit, unit_price, total)
         VALUES (?, ?, 1, 'global', 0, 0)`,
        [quoteId, request.service || request.description || "Trabajo solicitado"]
      );
    }

    const [jobRows] = await connection.query(
      "SELECT id,status FROM jobs WHERE quote_id=? LIMIT 1",
      [quoteId]
    );

    if (jobRows.length) {
      await connection.commit();
      connection.release();
      return res.json({
        success: true,
        already_exists: true,
        job_id: jobRows[0].id,
        quote_id: quoteId,
        quote_number: quoteNumber,
        status: jobRows[0].status
      });
    }

    const [jobResult] = await connection.query(
      "INSERT INTO jobs (quote_id,status) VALUES (?, 'pendiente_presupuesto')",
      [quoteId]
    );

    await connection.query(
      `INSERT INTO quote_request_history
        (quote_request_id, actor_user_id, action, old_status, new_status, metadata)
       VALUES (?, ?, 'converted_to_job', ?, 'programada', ?)`,
      [id, req.session.user.id, request.status, JSON.stringify({ quote_id: quoteId, job_id: jobResult.insertId })]
    );

    await connection.query(
      "UPDATE quote_requests SET status='programada' WHERE id=?",
      [id]
    );

    await connection.commit();
    connection.release();

    await writeAudit(req, "request_converted_to_job", "quote_request", id, {
      quote_id: quoteId,
      job_id: jobResult.insertId
    });

    res.status(201).json({
      success: true,
      job_id: jobResult.insertId,
      quote_id: quoteId,
      quote_number: quoteNumber,
      status: "programada"
    });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error convirtiendo solicitud a trabajo", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo convertir la solicitud en trabajo." });
  }
});

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
    const token = String(req.params.token || "").trim();
    if (!/^[A-Za-z0-9_-]{24,200}$/.test(token)) {
      return res.status(404).json({ error: "Presupuesto no encontrado o enlace inválido." });
    }

    const [rows] = await pool.query(
      `SELECT
        q.id, q.quote_number, q.issue_date, q.expiration_date, q.notes,
        q.status, q.subtotal, q.discount, q.total, q.viewed_at,
        qr.name AS client_name, qr.email AS client_email, qr.phone AS client_phone,
        qr.service AS requested_service,
        qi.id AS item_id, qi.description, qi.quantity, qi.unit, qi.unit_price,
        qi.total AS item_total,
        qa.id AS acceptance_id, qa.decision AS acceptance_decision,
        qa.customer_name AS acceptance_customer_name,
        qa.customer_email AS acceptance_customer_email,
        qa.customer_phone AS acceptance_customer_phone,
        qa.customer_note AS acceptance_note,
        qa.consent_text AS acceptance_consent_text,
        qa.signature_name AS acceptance_signature_name,
        qa.ip_address AS acceptance_ip,
        qa.user_agent AS acceptance_user_agent,
        qa.created_at AS acceptance_created_at
      FROM quotes q
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN quote_items qi ON qi.quote_id=q.id
      LEFT JOIN (
        SELECT qa1.*
        FROM quote_acceptances qa1
        INNER JOIN (
          SELECT quote_id, MAX(id) AS max_id
          FROM quote_acceptances
          GROUP BY quote_id
        ) latest ON latest.max_id=qa1.id
      ) qa ON qa.quote_id=q.id
      WHERE q.access_token=?
      ORDER BY qi.id ASC`,
      [token]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Presupuesto no encontrado o enlace inválido." });
    }

    await pool.query(
      "UPDATE quotes SET viewed_at=COALESCE(viewed_at,NOW()) WHERE id=?",
      [rows[0].id]
    ).catch(() => {});

    const row = rows[0];
    const quote = {
      id: row.id,
      quote_number: row.quote_number,
      issue_date: row.issue_date,
      expiration_date: row.expiration_date,
      notes: row.notes,
      status: row.status,
      viewed_at: row.viewed_at,
      subtotal: row.subtotal,
      discount: row.discount,
      total: row.total,
      client_name: row.client_name,
      client_email: row.client_email,
      client_phone: row.client_phone,
      requested_service: row.requested_service,
      items: [],
      acceptance: row.acceptance_id ? {
        id: row.acceptance_id,
        decision: row.acceptance_decision,
        customer_name: row.acceptance_customer_name,
        customer_email: row.acceptance_customer_email,
        customer_phone: row.acceptance_customer_phone,
        note: row.acceptance_note,
        consent_text: row.acceptance_consent_text,
        signature_name: row.acceptance_signature_name,
        ip_address: row.acceptance_ip,
        user_agent: row.acceptance_user_agent,
        created_at: row.acceptance_created_at
      } : null
    };

    for (const item of rows) {
      if (item.item_id) {
        quote.items.push({
          id: item.item_id,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price,
          total: item.item_total
        });
      }
    }

    res.json(quote);
  } catch (error) {
    logError("Error obteniendo presupuesto público", { requestId:req.requestId, error:error.message });
    res.status(500).json({ error:"No se pudo obtener el presupuesto." });
  }
});
// ========================================
// PRESUPUESTOS - ADMIN
// ========================================

// =========================================================
// PRESUPUESTOS V2 — ADMIN
// =========================================================

const QUOTE_STATUSES = [
  "borrador",
  "enviado",
  "aceptado",
  "rechazado",
  "vencido",
  "cerrado"
];

function validateQuoteId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateQuoteStatus(value) {
  return QUOTE_STATUSES.includes(String(value || "").trim());
}

function validateQuoteDate(value) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  return text;
}

async function recordQuoteHistory(req, quoteId, action, oldStatus, newStatus, metadata = null, db = pool) {
  await db.query(
    `INSERT INTO quote_history
      (quote_id, actor_user_id, action, old_status, new_status, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      quoteId,
      req.session?.user?.id || null,
      action,
      oldStatus || null,
      newStatus || null,
      metadata ? JSON.stringify(metadata) : null
    ]
  );
}

async function notifyQuoteWhatsApp(quote) {
  try {
    const settings=await whatsappBusinessEnabled();
    if(!settings?.whatsapp_auto_notifications || !quote?.phone) return false;
    await queueWhatsApp({
      to:quote.phone,
      message:`JR Electricidad: tu presupuesto ${quote.quote_number} ya está disponible. Podés consultarlo en: ${(process.env.APP_URL || "")}/presupuesto/${encodeURIComponent(quote.access_token)}`,
      entityType:"quote",
      entityId:quote.id
    });
    return true;
  } catch(error) {
    logError("No se pudo encolar WhatsApp del presupuesto",{requestId:null,error:error.message,quoteId:quote?.id});
    return false;
  }
}

async function sendQuoteEmail(quote) {
  if (!quote?.email) return false;
  try {
    await queueEmail({
      to: quote.email,
      subject: "Presupuesto " + quote.quote_number + " - JR Electricidad",
      template: "quote_sent",
      data: {
        name: quote.name || quote.client_name || "",
        quoteNumber: quote.quote_number,
        total: quoteMoney(quote.total),
        link: (process.env.APP_URL || "") + "/presupuesto/" + encodeURIComponent(quote.access_token)
      }
    });
    return true;
  } catch (error) {
    logError("No se pudo encolar el presupuesto por email", {
      requestId: null,
      quoteId: quote.id,
      error: error.message
    });
    return false;
  }
}

// PDF del presupuesto.
app.get("/api/admin/quotes/:id(\\d+)/pdf", requireAdmin, async (req, res) => {
  try {
    const id = validateQuoteId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID de presupuesto inválido." });

    const quote = await getQuoteDetail(pool, id);
    if (!quote) return res.status(404).json({ error: "Presupuesto no encontrado." });

    const doc = buildQuotePdf(quote);
    const pdf = await pdfToBuffer(doc);
    const filename = quote.pdf_filename || `presupuesto-${quote.quote_number || id}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${String(filename).replace(/[^a-zA-Z0-9._-]/g, "_")}"`
    );
    res.setHeader("Content-Length", pdf.length);
    res.send(pdf);
  } catch (error) {
    logError("Error generando PDF del presupuesto", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo generar el PDF del presupuesto." });
  }
});

// Listado con búsqueda y filtros.
app.get("/api/admin/quotes", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    if (status && !validateQuoteStatus(status)) {
      return res.status(400).json({ error: "Estado de presupuesto inválido." });
    }

    const params = [];
    let sql = `
      SELECT
        q.id,q.quote_number,q.access_token,q.issue_date,q.expiration_date,
        q.subtotal,q.discount,q.total,q.status,q.sent_at,q.accepted_at,
        q.rejected_at,q.created_at,q.updated_at,
        qr.id AS quote_request_id,qr.name AS client_name,qr.email AS client_email,
        qr.phone AS client_phone,qr.service AS requested_service,
        COUNT(qi.id) AS items_count,
        j.id AS job_id,j.status AS job_status
      FROM quotes q
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN quote_items qi ON qi.quote_id=q.id
      LEFT JOIN jobs j ON j.quote_id=q.id
      WHERE 1=1
    `;

    if (search) {
      const v = `%${search}%`;
      sql += " AND (q.quote_number LIKE ? OR qr.name LIKE ? OR qr.email LIKE ? OR qr.phone LIKE ? OR qr.service LIKE ?)";
      params.push(v,v,v,v,v);
    }
    if (status) {
      sql += " AND q.status=?";
      params.push(status);
    }
    if (dateFrom) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) return res.status(400).json({ error: "Fecha desde inválida." });
      sql += " AND DATE(q.created_at)>=?";
      params.push(dateFrom);
    }
    if (dateTo) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) return res.status(400).json({ error: "Fecha hasta inválida." });
      sql += " AND DATE(q.created_at)<=?";
      params.push(dateTo);
    }

    sql += `
      GROUP BY q.id,q.quote_number,q.access_token,q.issue_date,q.expiration_date,
        q.subtotal,q.discount,q.total,q.status,q.sent_at,q.accepted_at,q.rejected_at,
        q.created_at,q.updated_at,qr.id,qr.name,qr.email,qr.phone,qr.service,j.id,j.status
      ORDER BY q.created_at DESC,q.id DESC
    `;

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo presupuestos", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener los presupuestos." });
  }
});

// Detalle completo.
app.get("/api/admin/quotes/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = validateQuoteId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID de presupuesto inválido." });

    const quote = await getQuoteDetail(pool, id);
    if (!quote) return res.status(404).json({ error: "Presupuesto no encontrado." });

    const [history] = await pool.query(
      `SELECT h.*,u.name AS actor_name
       FROM quote_history h
       LEFT JOIN users u ON u.id=h.actor_user_id
       WHERE h.quote_id=?
       ORDER BY h.created_at DESC,h.id DESC`,
      [id]
    );

    const [jobs] = await pool.query(
      "SELECT id,status,started_at,completed_at,created_at,updated_at FROM jobs WHERE quote_id=? ORDER BY id DESC",
      [id]
    );

    res.json({ ...quote, history, jobs });
  } catch (error) {
    logError("Error obteniendo detalle de presupuesto", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo obtener el presupuesto." });
  }
});

// Crear presupuesto.
app.post("/api/admin/quotes", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const body = req.body || {};
    const requestId = validateRequestId(body.quote_request_id);
    if (!requestId) {
      connection.release();
      return res.status(400).json({ error: "La solicitud asociada es obligatoria." });
    }

    const issueDate = validateQuoteDate(body.issue_date);
    const expirationDate = validateQuoteDate(body.expiration_date);
    if (issueDate === undefined || expirationDate === undefined) {
      connection.release();
      return res.status(400).json({ error: "Las fechas del presupuesto no son válidas." });
    }

    const discount = Number(body.discount || 0);
    if (!Number.isFinite(discount) || discount < 0 || discount > 1000000000) {
      connection.release();
      return res.status(400).json({ error: "El descuento no es válido." });
    }

    const items = cleanQuoteItems(body.items);
    const subtotal = items.reduce((sum,item) => sum + item.total, 0);
    if (discount > subtotal) {
      connection.release();
      return res.status(400).json({ error: "El descuento no puede superar el subtotal." });
    }
    const total = subtotal - discount;
    const notes = String(body.notes || "").trim();
    if (notes.length > 5000) {
      connection.release();
      return res.status(400).json({ error: "Las notas no pueden superar 5000 caracteres." });
    }

    await connection.beginTransaction();

    const [requestRows] = await connection.query(
      "SELECT * FROM quote_requests WHERE id=? LIMIT 1 FOR UPDATE",
      [requestId]
    );
    if (!requestRows.length) {
      await connection.rollback(); connection.release();
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const quoteNumber = `PR-${new Date().toISOString().replace(/\D/g,"").slice(0,14)}-${requestId}`;
    const accessToken = crypto.randomBytes(32).toString("hex");

    const [result] = await connection.query(
      `INSERT INTO quotes
       (quote_request_id,quote_number,access_token,issue_date,expiration_date,notes,status,subtotal,discount,total)
       VALUES (?,?,?,?,?,?,'borrador',?,?,?)`,
      [requestId,quoteNumber,accessToken,issueDate || new Date().toISOString().slice(0,10),expirationDate,notes,subtotal,discount,total]
    );

    for (const item of items) {
      await connection.query(
        `INSERT INTO quote_items (quote_id,description,quantity,unit,unit_price,total)
         VALUES (?,?,?,?,?,?)`,
        [result.insertId,item.description,item.quantity,item.unit,item.unit_price,item.total]
      );
    }

    await connection.query(
      `INSERT INTO quote_history (quote_id,actor_user_id,action,new_status,metadata)
       VALUES (?,?,'quote_created','borrador',?)`,
      [result.insertId,req.session.user.id,JSON.stringify({ quote_request_id: requestId, items: items.length })]
    );

    await connection.commit();
    connection.release();

    await writeAudit(req,"quote_created","quote",result.insertId,{quote_request_id:requestId,total});

    res.status(201).json({
      success:true,
      id:result.insertId,
      quote_id:result.insertId,
      quote_number:quoteNumber,
      total
    });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error creando presupuesto", { requestId:req.requestId, error:error.message });
    res.status(500).json({ error:"No se pudo crear el presupuesto." });
  }
});

// Actualizar presupuesto.
app.put("/api/admin/quotes/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = validateQuoteId(req.params.id);
    if (!id) { connection.release(); return res.status(400).json({error:"ID de presupuesto inválido."}); }

    const body = req.body || {};
    const issueDate = validateQuoteDate(body.issue_date);
    const expirationDate = validateQuoteDate(body.expiration_date);
    if (issueDate === undefined || expirationDate === undefined) {
      connection.release(); return res.status(400).json({error:"Las fechas del presupuesto no son válidas."});
    }

    const discount = Number(body.discount || 0);
    if (!Number.isFinite(discount) || discount < 0 || discount > 1000000000) {
      connection.release(); return res.status(400).json({error:"El descuento no es válido."});
    }

    const items = cleanQuoteItems(body.items);
    const subtotal = items.reduce((sum,item)=>sum+item.total,0);
    if (discount > subtotal) {
      connection.release(); return res.status(400).json({error:"El descuento no puede superar el subtotal."});
    }
    const total = subtotal-discount;
    const notes = String(body.notes || "").trim();
    if (notes.length > 5000) {
      connection.release(); return res.status(400).json({error:"Las notas no pueden superar 5000 caracteres."});
    }

    await connection.beginTransaction();

    const [rows] = await connection.query("SELECT * FROM quotes WHERE id=? LIMIT 1 FOR UPDATE",[id]);
    if (!rows.length) {
      await connection.rollback(); connection.release();
      return res.status(404).json({error:"Presupuesto no encontrado."});
    }

    const current = rows[0];
    if (["aceptado","cerrado"].includes(current.status)) {
      await connection.rollback(); connection.release();
      return res.status(409).json({error:"No se puede modificar un presupuesto aceptado o cerrado."});
    }

    await connection.query(
      `UPDATE quotes
       SET issue_date=?,expiration_date=?,notes=?,subtotal=?,discount=?,total=?
       WHERE id=?`,
      [issueDate || current.issue_date,expirationDate,notes,subtotal,discount,total,id]
    );

    await connection.query("DELETE FROM quote_items WHERE quote_id=?",[id]);
    for (const item of items) {
      await connection.query(
        `INSERT INTO quote_items (quote_id,description,quantity,unit,unit_price,total)
         VALUES (?,?,?,?,?,?)`,
        [id,item.description,item.quantity,item.unit,item.unit_price,item.total]
      );
    }

    await connection.query(
      `INSERT INTO quote_history (quote_id,actor_user_id,action,old_status,new_status,metadata)
       VALUES (?,?,'quote_updated',?,?,?)`,
      [id,req.session.user.id,current.status,current.status,JSON.stringify({subtotal,discount,total,items:items.length})]
    );

    await connection.commit();
    connection.release();

    await writeAudit(req,"quote_updated","quote",id,{subtotal,discount,total});

    res.json({success:true,message:"Presupuesto actualizado correctamente.",total});
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error actualizando presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el presupuesto."});
  }
});

// Cambiar estado y enviar al cliente.
app.patch("/api/admin/quotes/:id(\\d+)/status", requireAdmin, adminMutationLimiter, async (req,res)=>{
  const id=validateQuoteId(req.params.id);
  const status=String(req.body?.status||"").trim();

  if(!id || !validateQuoteStatus(status)) {
    return res.status(400).json({error:"Estado de presupuesto inválido."});
  }

  try {
    const [rows]=await pool.query(
      `SELECT q.*,qr.name,qr.email
       FROM quotes q INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE q.id=? LIMIT 1`,[id]
    );
    if(!rows.length) return res.status(404).json({error:"Presupuesto no encontrado."});
    const current=rows[0];

    if(["aceptado","cerrado"].includes(current.status) && current.status!==status) {
      return res.status(409).json({error:"El presupuesto ya está cerrado para cambios."});
    }

    const allowedTransitions={
      borrador:["borrador","enviado","cerrado"],
      enviado:["enviado","aceptado","rechazado","vencido","cerrado"],
      aceptado:["aceptado","cerrado"],
      rechazado:["rechazado","borrador","cerrado"],
      vencido:["vencido","borrador","cerrado"],
      cerrado:["cerrado"]
    };

    if(!allowedTransitions[current.status]?.includes(status)) {
      return res.status(409).json({error:`No se puede pasar de "${current.status}" a "${status}".`});
    }

    const sentAt=status==="enviado" ? new Date() : current.sent_at;
    const acceptedAt=status==="aceptado" ? new Date() : current.accepted_at;
    const rejectedAt=status==="rechazado" ? new Date() : current.rejected_at;

    await pool.query(
      `UPDATE quotes SET status=?,sent_at=?,accepted_at=?,rejected_at=? WHERE id=?`,
      [status,sentAt,acceptedAt,rejectedAt,id]
    );

    await recordQuoteHistory(req,id,"quote_status_changed",current.status,status,{});

    await writeAudit(req,"quote_status_changed","quote",id,{old_status:current.status,new_status:status});

    if(status==="enviado") {
      const sent=await sendQuoteEmail({...current,status,total:current.total});
      await notifyQuoteWhatsApp({...current,status,total:current.total});
      await createAdminNotification({
        type: "quote_sent",
        quoteId: id,
        entityType: "quote",
        entityId: id,
        message: `El presupuesto ${current.quote_number} fue marcado como enviado.`,
        linkUrl: "/admin.html#quotesSection",
        priority: "normal"
      }).catch(() => {});
      res.json({success:true,status,email_sent:sent,message:sent?"Presupuesto enviado al cliente.":"Presupuesto marcado como enviado; email no disponible o no configurado."});
      return;
    }

    if(status==="aceptado") {
      await pool.query(
        "UPDATE quote_requests SET status='aceptada' WHERE id=? AND status NOT IN ('cerrada','finalizada')",
        [current.quote_request_id]
      );
    }

    res.json({success:true,status});
  } catch(error) {
    logError("Error cambiando estado del presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo cambiar el estado del presupuesto."});
  }
});

// Eliminar solamente borradores.
app.delete("/api/admin/quotes/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req,res)=>{
  try {
    const id=validateQuoteId(req.params.id);
    if(!id) return res.status(400).json({error:"ID de presupuesto inválido."});

    const [rows]=await pool.query("SELECT status,quote_number FROM quotes WHERE id=? LIMIT 1",[id]);
    if(!rows.length) return res.status(404).json({error:"Presupuesto no encontrado."});
    if(rows[0].status!=="borrador") return res.status(409).json({error:"Solo se pueden eliminar presupuestos en borrador."});

    await pool.query("DELETE FROM quotes WHERE id=?",[id]);
    await writeAudit(req,"quote_deleted","quote",id,{quote_number:rows[0].quote_number});
    res.json({success:true,message:"Presupuesto eliminado."});
  } catch(error) {
    logError("Error eliminando presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo eliminar el presupuesto."});
  }
});

// Historial del presupuesto.
app.get("/api/admin/quotes/:id(\\d+)/history", requireAdmin, async (req,res)=>{
  try {
    const id=validateQuoteId(req.params.id);
    if(!id) return res.status(400).json({error:"ID de presupuesto inválido."});
    const [rows]=await pool.query(
      `SELECT h.*,u.name AS actor_name
       FROM quote_history h LEFT JOIN users u ON u.id=h.actor_user_id
       WHERE h.quote_id=? ORDER BY h.created_at DESC,h.id DESC`,[id]
    );
    res.json(rows);
  } catch(error) {
    logError("Error obteniendo historial de presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el historial del presupuesto."});
  }
});

// =====================================================
// NOTIFICACIONES DEL ADMINISTRADOR — V2
// =====================================================

app.get("/api/admin/notifications", requireAdmin, async (req,res) => {
  try {
    const limitRaw = Number(req.query.limit || 50);
    const limit = Math.min(Math.max(Number.isInteger(limitRaw) ? limitRaw : 50, 1), 100);
    const includeArchived = String(req.query.archived || "") === "1";
    const recipient = Number(req.session.user.id);

    const [rows] = await pool.query(
      `SELECT id,user_id,type,quote_id,entity_type,entity_id,message,link_url,priority,
              is_read,read_at,archived_at,created_at
       FROM admin_notifications
       WHERE (user_id IS NULL OR user_id=?)
         AND (?=1 OR archived_at IS NULL)
       ORDER BY is_read ASC, created_at DESC, id DESC
       LIMIT ${limit}`,
      [recipient, includeArchived ? 1 : 0]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS unread
       FROM admin_notifications
       WHERE (user_id IS NULL OR user_id=?)
         AND is_read=0
         AND archived_at IS NULL`,
      [recipient]
    );

    res.json({
      success:true,
      notifications:rows,
      unread:Number(countRows[0]?.unread || 0)
    });
  } catch(error) {
    logError("Error obteniendo notificaciones",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron obtener las notificaciones."});
  }
});

app.post("/api/admin/notifications/:id/read", requireAdmin, async (req,res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de notificación inválido."});
    const [result]=await pool.query(
      `UPDATE admin_notifications
       SET is_read=1,read_at=COALESCE(read_at,NOW())
       WHERE id=? AND (user_id IS NULL OR user_id=?) AND archived_at IS NULL`,
      [id,Number(req.session.user.id)]
    );
    if(!result.affectedRows) return res.status(404).json({error:"Notificación no encontrada."});
    res.json({success:true,message:"Notificación marcada como leída."});
  } catch(error) {
    logError("Error marcando notificación",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar la notificación."});
  }
});

app.post("/api/admin/notifications/read-all", requireAdmin, async (req,res) => {
  try {
    await pool.query(
      `UPDATE admin_notifications
       SET is_read=1,read_at=COALESCE(read_at,NOW())
       WHERE (user_id IS NULL OR user_id=?)
         AND is_read=0 AND archived_at IS NULL`,
      [Number(req.session.user.id)]
    );
    res.json({success:true,message:"Todas las notificaciones fueron marcadas como leídas."});
  } catch(error) {
    logError("Error marcando notificaciones",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron marcar las notificaciones como leídas."});
  }
});

app.post("/api/admin/notifications/:id/archive", requireAdmin, async (req,res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de notificación inválido."});
    const [result]=await pool.query(
      `UPDATE admin_notifications
       SET archived_at=NOW(),is_read=1,read_at=COALESCE(read_at,NOW())
       WHERE id=? AND (user_id IS NULL OR user_id=?) AND archived_at IS NULL`,
      [id,Number(req.session.user.id)]
    );
    if(!result.affectedRows) return res.status(404).json({error:"Notificación no encontrada."});
    res.json({success:true,message:"Notificación archivada."});
  } catch(error) {
    logError("Error archivando notificación",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo archivar la notificación."});
  }
});

app.post("/api/admin/notifications/archive-all", requireAdmin, async (req,res) => {
  try {
    await pool.query(
      `UPDATE admin_notifications
       SET archived_at=NOW(),is_read=1,read_at=COALESCE(read_at,NOW())
       WHERE (user_id IS NULL OR user_id=?) AND archived_at IS NULL`,
      [Number(req.session.user.id)]
    );
    res.json({success:true,message:"Todas las notificaciones fueron archivadas."});
  } catch(error) {
    logError("Error archivando notificaciones",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron archivar las notificaciones."});
  }
});

// =========================================================
// V2 — EMAIL / ESTADO DE ENTREGA
// =========================================================

app.get("/api/admin/email/status", requireAdmin, async (req,res) => {
  try {
    const [rows] = await pool.query(
      `SELECT status,COUNT(*) AS total,MAX(created_at) AS last_created,MAX(sent_at) AS last_sent
       FROM email_outbox GROUP BY status ORDER BY status`
    );
    res.json({
      success:true,
      smtp_configured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.MAIL_FROM),
      statuses: rows
    });
  } catch(error) {
    logError("Error obteniendo estado de email",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el estado del email."});
  }
});

app.get("/api/admin/email/outbox", requireAdmin, async (req,res) => {
  try {
    const limit=Math.min(Math.max(Number(req.query.limit)||50,1),100);
    const status=String(req.query.status||"").trim();
    const params=[];
    let sql=`SELECT id,to_email,subject,template,status,attempts,max_attempts,next_attempt_at,sent_at,last_error,provider_message_id,request_id,created_at,updated_at
              FROM email_outbox WHERE 1=1`;
    if(status){
      const allowed=["queued","sending","sent","failed","skipped"];
      if(!allowed.includes(status)) return res.status(400).json({error:"Estado de email inválido."});
      sql+=" AND status=?";
      params.push(status);
    }
    sql+=" ORDER BY id DESC LIMIT "+limit;
    const [rows]=await pool.query(sql,params);
    res.json({success:true,emails:rows});
  } catch(error) {
    logError("Error obteniendo cola de email",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener la cola de email."});
  }
});

// =========================================================
// V2 — WHATSAPP
// =========================================================

async function whatsappBusinessEnabled() {
  const [rows] = await pool.query(
    "SELECT whatsapp,whatsapp_enabled,whatsapp_auto_notifications FROM business_settings WHERE id=1 LIMIT 1"
  );
  return rows[0] || null;
}

app.get("/api/admin/whatsapp/status", requireAdmin, async (req,res) => {
  try {
    const settings=await whatsappBusinessEnabled();
    const [rows]=await pool.query(
      "SELECT status,COUNT(*) AS total,MAX(created_at) AS last_created,MAX(sent_at) AS last_sent FROM whatsapp_outbox GROUP BY status"
    );
    res.json({
      success:true,
      provider_configured: whatsappProviderConfigured(),
      settings: settings || null,
      statuses: rows
    });
  } catch(error) {
    logError("Error obteniendo estado de WhatsApp",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el estado de WhatsApp."});
  }
});

app.get("/api/admin/whatsapp/outbox", requireAdmin, async (req,res) => {
  try {
    const limit=Math.min(Math.max(Number(req.query.limit)||50,1),100);
    const status=String(req.query.status||"").trim();
    const params=[];
    let sql=`SELECT id,to_phone,message,status,attempts,max_attempts,next_attempt_at,sent_at,last_error,provider_message_id,entity_type,entity_id,request_id,created_at,updated_at
              FROM whatsapp_outbox WHERE 1=1`;
    if(status){
      const allowed=["queued","sending","sent","failed","skipped"];
      if(!allowed.includes(status)) return res.status(400).json({error:"Estado de WhatsApp inválido."});
      sql+=" AND status=?";
      params.push(status);
    }
    sql+=" ORDER BY id DESC LIMIT "+limit;
    const [rows]=await pool.query(sql,params);
    res.json({success:true,messages:rows});
  } catch(error) {
    logError("Error obteniendo outbox de WhatsApp",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener la cola de WhatsApp."});
  }
});

app.post("/api/admin/whatsapp/send", requireAdmin, adminMutationLimiter, async (req,res) => {
  try {
    const phone=String(req.body.phone||"").trim();
    const message=String(req.body.message||"").trim();
    if(!phone || !message) return res.status(400).json({error:"Teléfono y mensaje son obligatorios."});
    const result=await queueWhatsApp({
      to:phone,
      message,
      requestId:req.requestId,
      entityType:String(req.body.entity_type||"manual").slice(0,50),
      entityId:req.body.entity_id ? Number(req.body.entity_id) : null
    });
    await writeAudit(req,"whatsapp_queued","whatsapp",result.id,{phone:result.phone});
    res.json({success:true,...result});
  } catch(error) {
    logError("Error encolando WhatsApp manual",{requestId:req.requestId,error:error.message});
    res.status(400).json({error:error.message});
  }
});

app.post("/api/admin/whatsapp/link", requireAdmin, async (req,res) => {
  try {
    const phone=String(req.body.phone||"").trim();
    const message=String(req.body.message||"").trim();
    const link=buildWhatsAppLink(phone,message);
    if(!link) return res.status(400).json({error:"Número de WhatsApp inválido."});
    res.json({success:true,link});
  } catch(error) {
    res.status(400).json({error:"No se pudo generar el enlace de WhatsApp."});
  }
});

// =========================================================
// V2 — ACEPTACIÓN DIGITAL DE PRESUPUESTOS
// =========================================================

const ACCEPTANCE_CONSENT_TEXT =
  "Declaro que revisé el presupuesto, sus conceptos, importes y condiciones, y autorizo a JR Electricidad a registrar digitalmente mi decisión.";

function validatePublicCustomer(body) {
  const name = String(body?.name || "").trim().replace(/\s+/g," ");
  const email = String(body?.email || "").trim().toLowerCase();
  const phone = String(body?.phone || "").trim();
  const note = String(body?.note || "").trim();
  const signatureName = String(body?.signatureName || "").trim().replace(/\s+/g," ");
  if(name.length<2||name.length>150) return {error:"Ingresá un nombre válido."};
  if(!validEmail(email)) return {error:"Ingresá un email válido."};
  if(phone.length<6||phone.length>50) return {error:"Ingresá un teléfono válido."};
  if(note.length>2000) return {error:"La observación no puede superar 2000 caracteres."};
  if(signatureName.length<2||signatureName.length>150) return {error:"Ingresá tu nombre como firma digital."};
  return {name,email,phone,note,signatureName};
}

function publicQuoteToken(req) {
  const token=String(req.params.token||"").trim();
  return /^[A-Za-z0-9_-]{24,200}$/.test(token) ? token : null;
}

async function sendAcceptanceEmail({to,quoteNumber,decision,customerName}) {
  if (!to) return false;
  try {
    await queueEmail({
      to,
      subject: (decision==="aceptado"?"Aceptación":"Rechazo") + " de presupuesto " + quoteNumber + " - JR Electricidad",
      template: "quote_decision",
      data: { customerName, quoteNumber, decision }
    });
    return true;
  } catch(error) {
    logError("No se pudo encolar confirmación de aceptación", {
      requestId:null,
      error:error.message,
      quoteNumber
    });
    return false;
  }
}

async function processPublicQuoteDecision(req,res,decision) {
  const token=publicQuoteToken(req);
  if(!token) return res.status(404).json({error:"Presupuesto no encontrado o enlace inválido."});
  const customer=validatePublicCustomer(req.body||{});
  if(customer.error) return res.status(400).json({error:customer.error});
  if(decision==="aceptado"&&req.body?.consent!==true) {
    return res.status(400).json({error:"Debés aceptar la constancia digital antes de confirmar."});
  }

  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]=await connection.query(
      `SELECT q.*,qr.name AS client_name,qr.email AS client_email,qr.phone AS client_phone
       FROM quotes q
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE q.access_token=? LIMIT 1 FOR UPDATE`,
      [token]
    );
    if(!rows.length) {
      await connection.rollback();
      return res.status(404).json({error:"Presupuesto no encontrado o enlace inválido."});
    }

    const quote=rows[0];
    if(["cerrado","vencido"].includes(quote.status) ||
       (quote.expiration_date && new Date(quote.expiration_date).getTime() < new Date().setHours(0,0,0,0))) {
      await connection.rollback();
      return res.status(409).json({error:"Este presupuesto está vencido o cerrado y ya no admite una decisión."});
    }
    if(quote.status===decision) {
      await connection.rollback();
      return res.json({success:true,status:decision,already_decided:true,message:`El presupuesto ya figura como ${decision}.`});
    }
    if(quote.status!=="enviado") {
      await connection.rollback();
      return res.status(409).json({error:"Este presupuesto no está disponible para una nueva decisión."});
    }

    const ip=req.ip||null;
    const userAgent=String(req.get("user-agent")||"").slice(0,512)||null;

    const [insertResult]=await connection.query(
      `INSERT INTO quote_acceptances
       (quote_id,decision,customer_name,customer_email,customer_phone,customer_note,consent_text,signature_name,ip_address,user_agent)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [quote.id,decision,customer.name,customer.email,customer.phone,customer.note||null,
       decision==="aceptado"?ACCEPTANCE_CONSENT_TEXT:null,customer.signatureName,ip,userAgent]
    );

    if(decision==="aceptado") {
      await connection.query(
        "UPDATE quotes SET status='aceptado',accepted_at=NOW() WHERE id=?",
        [quote.id]
      );
      await connection.query(
        "UPDATE quote_requests SET status='aceptada' WHERE id=? AND status NOT IN ('cerrada','finalizada')",
        [quote.quote_request_id]
      );
      await connection.query(
        `INSERT INTO jobs (quote_id,status) VALUES (?, 'aceptado')
         ON DUPLICATE KEY UPDATE status='aceptado',updated_at=CURRENT_TIMESTAMP`,
        [quote.id]
      );
    } else {
      await connection.query(
        "UPDATE quotes SET status='rechazado',rejected_at=NOW() WHERE id=?",
        [quote.id]
      );
    }

    await connection.query(
      `INSERT INTO quote_history (quote_id,action,old_status,new_status,metadata)
       VALUES (?,'customer_decision','enviado',?,?)`,
      [quote.id,decision,JSON.stringify({
        source:"public",
        acceptance_id:insertResult.insertId,
        customer_name:customer.name,
        customer_email:customer.email,
        consent:decision==="aceptado"
      })]
    );

    await connection.query(
      "INSERT INTO admin_notifications (user_id,type,quote_id,entity_type,entity_id,message,link_url,priority,is_read,read_at,archived_at) VALUES (NULL,?,?,?,?,?,?,?,0,NULL,NULL)",
      [
        decision==="aceptado"?"quote_accepted":"quote_rejected",
        quote.id,
        "quote",
        quote.id,
        `El cliente ${quote.client_name} registró ${decision==="aceptado"?"la aceptación":"el rechazo"} del presupuesto ${quote.quote_number}.`,
        "/admin.html#quotesSection",
        "high"
      ]
    );

    await connection.commit();

    const emailSent=await sendAcceptanceEmail({
      to:customer.email,
      quoteNumber:quote.quote_number,
      decision,
      customerName:customer.name
    });

    await writeAudit(req,`quote_${decision}_public`,"quote",quote.id,{
      customer_name:customer.name,
      customer_email:customer.email,
      ip,
      user_agent:userAgent,
      email_sent:emailSent
    });

    res.json({
      success:true,
      status:decision,
      email_sent:emailSent,
      message:decision==="aceptado"
        ?"Presupuesto aceptado. Se registró tu aceptación y se creó el trabajo."
        :"Presupuesto rechazado. Se registró tu decisión correctamente."
    });
  } catch(error) {
    await connection.rollback().catch(()=>{});
    logError("Error procesando decisión pública del presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo registrar la decisión del presupuesto."});
  } finally {
    connection.release();
  }
}

app.post("/api/public/quotes/:token/accept",authLimiter,async(req,res)=>{
  return processPublicQuoteDecision(req,res,"aceptado");
});

app.post("/api/public/quotes/:token/reject",authLimiter,async(req,res)=>{
  return processPublicQuoteDecision(req,res,"rechazado");
});




// =========================================================
// FASE 14 — GESTIÓN CENTRALIZADA DE DOCUMENTOS
// =========================================================

function validateDocumentEntityId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function documentAbsolutePath(storedName) {
  const base = path.resolve(documentsDir);
  const target = path.resolve(base, String(storedName || ""));
  if (target !== base && !target.startsWith(base + path.sep)) {
    return null;
  }
  return target;
}

async function createStoredDocument({
  title,
  description = null,
  documentType,
  clientId = null,
  quoteRequestId = null,
  quoteId = null,
  jobId = null,
  originalName,
  mimeType,
  filePath,
  createdByUserId
}) {
  const type = normalizeDocumentType(documentType);
  if (!type) throw new Error("Tipo de documento inválido.");
  const stat = await fs.promises.stat(filePath);
  if (stat.size > MAX_DOCUMENT_SIZE) throw new Error("El documento supera los 10 MB.");
  const handle = await fs.promises.open(filePath, "r");
  const header = Buffer.alloc(16);
  try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }
  if (!validateDocumentSignature(header, mimeType)) {
    throw new Error("La firma del archivo no coincide con su tipo.");
  }

  const safeName = safeDocumentName(originalName);
  const storedName = path.basename(filePath);
  const sha256 = await sha256File(filePath);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [docResult] = await connection.query(
      `INSERT INTO documents
        (document_type,title,description,client_id,quote_request_id,quote_id,job_id,created_by_user_id,current_version)
       VALUES (?,?,?,?,?,?,?,?,1)`,
      [
        type,
        String(title || safeName).trim().slice(0,255) || safeName,
        description ? String(description).trim().slice(0,10000) : null,
        clientId, quoteRequestId, quoteId, jobId, createdByUserId || null
      ]
    );
    const documentId = Number(docResult.insertId);
    await connection.query(
      `INSERT INTO document_versions
        (document_id,version_number,original_name,stored_name,storage_path,mime_type,size_bytes,sha256,created_by_user_id)
       VALUES (?,1,?,?,?,?,?,?,?)`,
      [documentId, safeName, storedName, "documents/" + storedName, mimeType, stat.size, sha256, createdByUserId || null]
    );
    await connection.commit();
    return { documentId, version: 1, sha256, sizeBytes: stat.size };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function createDocumentVersion(documentId, file, userId) {
  const id = validateDocumentEntityId(documentId);
  if (!id) throw new Error("ID de documento inválido.");
  const stat = await fs.promises.stat(file.path);
  if (stat.size > MAX_DOCUMENT_SIZE) throw new Error("El documento supera los 10 MB.");
  const handle = await fs.promises.open(file.path, "r");
  const header = Buffer.alloc(16);
  try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }
  if (!validateDocumentSignature(header, file.mimetype)) throw new Error("La firma del archivo no coincide con su tipo.");

  const [docs] = await pool.query("SELECT id,current_version FROM documents WHERE id=? LIMIT 1", [id]);
  if (!docs.length) throw new Error("Documento no encontrado.");
  const version = Number(docs[0].current_version || 0) + 1;
  const sha256 = await sha256File(file.path);
  await pool.query(
    `INSERT INTO document_versions
      (document_id,version_number,original_name,stored_name,storage_path,mime_type,size_bytes,sha256,created_by_user_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id,version,safeDocumentName(file.originalname),path.basename(file.path),"documents/"+path.basename(file.path),file.mimetype,stat.size,sha256,userId || null]
  );
  await pool.query("UPDATE documents SET current_version=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [version,id]);
  return { version, sha256, sizeBytes: stat.size };
}

async function buildJobDocumentPdf(job, type) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(20).text("JR ELECTRICIDAD");
  doc.fillColor("#f59e0b").fontSize(9).text("Electricista Matriculado · Cat. 3");
  doc.moveDown(1.2);
  doc.fillColor("#111827").fontSize(16).text(type === "work_completion" ? "CONSTANCIA DE TRABAJO" : "INFORME DE TRABAJO");
  doc.moveDown(.8);
  const lines = [
    ["Trabajo", "#" + job.id],
    ["Cliente", job.client_name || "-"],
    ["Teléfono", job.client_phone || "-"],
    ["Servicio", job.service || "-"],
    ["Estado", job.status || "-"],
    ["Ubicación", job.location || "-"],
    ["Programado", job.scheduled_at ? new Date(job.scheduled_at).toLocaleString("es-AR") : "-"],
    ["Inicio", job.started_at ? new Date(job.started_at).toLocaleString("es-AR") : "-"],
    ["Finalización", job.completed_at ? new Date(job.completed_at).toLocaleString("es-AR") : "-"],
    ["Técnico", job.technician_name || "-"]
  ];
  for (const [label,value] of lines) {
    doc.fillColor("#6b7280").font("Helvetica-Bold").fontSize(9).text(label.toUpperCase());
    doc.fillColor("#111827").font("Helvetica").fontSize(11).text(String(value));
    doc.moveDown(.35);
  }
  if (job.execution_notes) {
    doc.moveDown(.4).fillColor("#111827").font("Helvetica-Bold").fontSize(10).text("NOTAS DE EJECUCIÓN");
    doc.font("Helvetica").fontSize(10).text(String(job.execution_notes));
  }
  if (job.completion_notes) {
    doc.moveDown(.4).fillColor("#111827").font("Helvetica-Bold").fontSize(10).text("NOTAS DE FINALIZACIÓN");
    doc.font("Helvetica").fontSize(10).text(String(job.completion_notes));
  }
  doc.moveDown(2);
  doc.fillColor("#6b7280").fontSize(8).text("Documento generado por el panel de administración de JR Electricidad.");
  return pdfToBuffer(doc);
}

async function createGeneratedPdfDocument({ title, type, pdf, clientId, quoteRequestId, quoteId, jobId, userId, fileName }) {
  const tmp = path.join(documentsDir, documentFileName(fileName || "documento.pdf"));
  await fs.promises.writeFile(tmp, pdf);
  try {
    return await createStoredDocument({
      title, documentType:type, clientId, quoteRequestId, quoteId, jobId,
      originalName:fileName || "documento.pdf",
      mimeType:"application/pdf", filePath:tmp, createdByUserId:userId
    });
  } catch (error) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw error;
  }
}

app.get("/api/admin/documents", requireAdmin, async (req,res)=>{
  try {
    const q=String(req.query.q||"").trim().slice(0,120);
    const type=String(req.query.type||"").trim();
    const params=[];
    const where=[];
    if(q){
      where.push("(d.title LIKE ? OR d.description LIKE ? OR dv.original_name LIKE ? OR c.name LIKE ?)");
      const like="%"+q+"%"; params.push(like,like,like,like);
    }
    if(type){
      const normalized=normalizeDocumentType(type);
      if(!normalized) return res.status(400).json({error:"Tipo de documento inválido."});
      where.push("d.document_type=?"); params.push(normalized);
    }
    const sql=`SELECT d.id,d.document_type,d.title,d.description,d.client_id,d.quote_request_id,d.quote_id,d.job_id,
      d.current_version,d.created_at,d.updated_at,
      dv.id AS version_id,dv.original_name,dv.mime_type,dv.size_bytes,dv.sha256,dv.created_at AS version_created_at,
      c.name AS client_name
      FROM documents d
      INNER JOIN document_versions dv ON dv.document_id=d.id AND dv.version_number=d.current_version
      LEFT JOIN clients c ON c.id=d.client_id
      ${where.length?"WHERE "+where.join(" AND "):""}
      ORDER BY d.updated_at DESC,d.id DESC LIMIT 200`;
    const [rows]=await pool.query(sql,params);
    res.json({types:DOCUMENT_TYPES,documents:rows});
  }catch(error){
    logError("Error listando documentos",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron obtener los documentos."});
  }
});

app.get("/api/admin/documents/:id(\\d+)", requireAdmin, async(req,res)=>{
  try{
    const id=validateDocumentEntityId(req.params.id);
    if(!id) return res.status(400).json({error:"ID de documento inválido."});
    const [docs]=await pool.query(
      `SELECT d.*,c.name AS client_name FROM documents d LEFT JOIN clients c ON c.id=d.client_id WHERE d.id=? LIMIT 1`,[id]);
    if(!docs.length) return res.status(404).json({error:"Documento no encontrado."});
    const [versions]=await pool.query(
      `SELECT v.id,v.version_number,v.original_name,v.mime_type,v.size_bytes,v.sha256,v.created_at,u.name AS created_by_name
       FROM document_versions v LEFT JOIN users u ON u.id=v.created_by_user_id WHERE v.document_id=? ORDER BY v.version_number DESC`,[id]);
    res.json({...docs[0],versions});
  }catch(error){res.status(500).json({error:"No se pudo obtener el documento."});}
});

app.get("/api/admin/documents/:id(\\d+)/download", requireAdmin, async(req,res)=>{
  try{
    const id=validateDocumentEntityId(req.params.id);
    const version=req.query.version==null?null:Number(req.query.version);
    if(!id) return res.status(400).json({error:"ID de documento inválido."});
    let sql=`SELECT d.title,v.* FROM documents d INNER JOIN document_versions v ON v.document_id=d.id
      WHERE d.id=? ${version? "AND v.version_number=?":"AND v.version_number=d.current_version"} LIMIT 1`;
    const params=version?[id,version]:[id];
    const [rows]=await pool.query(sql,params);
    if(!rows.length) return res.status(404).json({error:"Versión de documento no encontrada."});
    const filePath=documentAbsolutePath(rows[0].stored_name);
    if(!filePath || !fs.existsSync(filePath)) return res.status(404).json({error:"Archivo no encontrado en almacenamiento."});
    await writeAudit(req,"document_downloaded","document",id,{version:rows[0].version_number});
    res.setHeader("Content-Type",rows[0].mime_type);
    res.setHeader("Content-Disposition",`attachment; filename="${safeDocumentName(rows[0].original_name)}"`);
    res.sendFile(filePath);
  }catch(error){logError("Error descargando documento",{requestId:req.requestId,error:error.message});res.status(500).json({error:"No se pudo descargar el documento."});}
});

app.post("/api/admin/documents/upload", requireAdmin, adminMutationLimiter, documentUpload.single("file"), async(req,res)=>{
  try{
    if(!req.file) return res.status(400).json({error:"Seleccioná un archivo."});
    const documentType=normalizeDocumentType(req.body.document_type);
    if(!documentType){await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"Tipo de documento inválido."});}
    const result=await createStoredDocument({
      title:String(req.body.title||req.file.originalname).trim(),
      description:req.body.description,
      documentType,
      clientId:validateDocumentEntityId(req.body.client_id),
      quoteRequestId:validateDocumentEntityId(req.body.quote_request_id),
      quoteId:validateDocumentEntityId(req.body.quote_id),
      jobId:validateDocumentEntityId(req.body.job_id),
      originalName:req.file.originalname,mimeType:req.file.mimetype,filePath:req.file.path,
      createdByUserId:req.session.user.id
    });
    await writeAudit(req,"document_created","document",result.documentId,{document_type:documentType,version:1});
    res.status(201).json({success:true,...result});
  }catch(error){
    if(req.file) await fs.promises.unlink(req.file.path).catch(()=>{});
    logError("Error subiendo documento",{requestId:req.requestId,error:error.message});
    res.status(400).json({error:error.message||"No se pudo guardar el documento."});
  }
});

app.post("/api/admin/documents/:id(\\d+)/versions", requireAdmin, adminMutationLimiter, documentUpload.single("file"), async(req,res)=>{
  try{
    if(!req.file) return res.status(400).json({error:"Seleccioná un archivo."});
    const result=await createDocumentVersion(req.params.id,req.file,req.session.user.id);
    await writeAudit(req,"document_version_created","document",Number(req.params.id),{version:result.version});
    res.status(201).json({success:true,...result});
  }catch(error){
    if(req.file) await fs.promises.unlink(req.file.path).catch(()=>{});
    res.status(400).json({error:error.message||"No se pudo crear la versión."});
  }
});

app.post("/api/admin/documents/from-quote/:quoteId(\\d+)", requireAdmin, adminMutationLimiter, async(req,res)=>{
  try{
    const quoteId=validateDocumentEntityId(req.params.quoteId);
    if(!quoteId) return res.status(400).json({error:"ID de presupuesto inválido."});
    const quote=await getQuoteDetail(pool,quoteId);
    if(!quote) return res.status(404).json({error:"Presupuesto no encontrado."});
    const pdf=await pdfToBuffer(buildQuotePdf(quote));
    const result=await createGeneratedPdfDocument({
      title:"Presupuesto "+(quote.quote_number||quoteId),
      type:"quote_pdf",pdf,
      clientId:quote.client_id||null,quoteRequestId:quote.quote_request_id||null,quoteId,
      userId:req.session.user.id,fileName:`presupuesto-${quote.quote_number||quoteId}.pdf`
    });
    await writeAudit(req,"quote_document_generated","document",result.documentId,{quote_id:quoteId});
    res.status(201).json({success:true,...result});
  }catch(error){logError("Error generando documento de presupuesto",{requestId:req.requestId,error:error.message});res.status(500).json({error:"No se pudo generar el PDF del presupuesto."});}
});

app.post("/api/admin/documents/from-job/:jobId(\\d+)", requireAdmin, adminMutationLimiter, async(req,res)=>{
  try{
    const jobId=validateDocumentEntityId(req.params.jobId);
    if(!jobId) return res.status(400).json({error:"ID de trabajo inválido."});
    const [rows]=await pool.query(
      `SELECT j.*,qr.name AS client_name,qr.phone AS client_phone,qr.service,qu.quote_number,
        u.name AS technician_name,c.id AS client_id
       FROM jobs j
       LEFT JOIN quote_requests qr ON qr.id=j.quote_request_id
       LEFT JOIN quotes qu ON qu.id=j.quote_id
       LEFT JOIN clients c ON c.id=qr.client_id
       LEFT JOIN users u ON u.id=j.assigned_user_id
       WHERE j.id=? LIMIT 1`,[jobId]);
    if(!rows.length) return res.status(404).json({error:"Trabajo no encontrado."});
    const type=String(req.body.type||"job_report")==="work_completion"?"work_completion":"job_report";
    const pdf=await buildJobDocumentPdf(rows[0],type);
    const result=await createGeneratedPdfDocument({
      title:(type==="work_completion"?"Constancia de trabajo #":"Informe de trabajo #")+jobId,
      type,pdf,clientId:rows[0].client_id||null,quoteRequestId:rows[0].quote_request_id||null,quoteId:rows[0].quote_id||null,jobId,
      userId:req.session.user.id,fileName:`${type}-${jobId}.pdf`
    });
    await writeAudit(req,"job_document_generated","document",result.documentId,{job_id:jobId,type});
    res.status(201).json({success:true,...result});
  }catch(error){logError("Error generando documento de trabajo",{requestId:req.requestId,error:error.message});res.status(500).json({error:"No se pudo generar el documento del trabajo."});}
});

app.delete("/api/admin/documents/:id(\\d+)", requireAdmin, adminMutationLimiter, async(req,res)=>{
  const connection=await pool.getConnection();
  try{
    const id=validateDocumentEntityId(req.params.id);
    if(!id){connection.release();return res.status(400).json({error:"ID de documento inválido."});}
    const [versions]=await connection.query("SELECT stored_name FROM document_versions WHERE document_id=?",[id]);
    const [result]=await connection.query("DELETE FROM documents WHERE id=?",[id]);
    if(!result.affectedRows){connection.release();return res.status(404).json({error:"Documento no encontrado."});}
    await connection.commit().catch(()=>{});
    connection.release();
    for(const row of versions){const p=documentAbsolutePath(row.stored_name);if(p) await fs.promises.unlink(p).catch(()=>{});}
    await writeAudit(req,"document_deleted","document",id,{versions:versions.length});
    res.json({success:true,message:"Documento eliminado."});
  }catch(error){await connection.rollback().catch(()=>{});connection.release();res.status(500).json({error:"No se pudo eliminar el documento."});}
});

app.get("/api/admin/documents/:id(\\d+)/versions", requireAdmin, async(req,res)=>{
  try{
    const id=validateDocumentEntityId(req.params.id);
    if(!id) return res.status(400).json({error:"ID de documento inválido."});
    const [rows]=await pool.query(
      `SELECT v.*,u.name AS created_by_name FROM document_versions v LEFT JOIN users u ON u.id=v.created_by_user_id WHERE v.document_id=? ORDER BY v.version_number DESC`,[id]);
    res.json(rows);
  }catch(error){res.status(500).json({error:"No se pudieron obtener las versiones."});}
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

start();"],
    ["tax_enabled","TINYINT(1) NOT NULL DEFAULT 0"],
    ["tax_name","VARCHAR(80) NOT NULL DEFAULT 'IVA'"],
    ["tax_rate","DECIMAL(6,3) NOT NULL DEFAULT 0"],
    ["quote_prefix","VARCHAR(20) NOT NULL DEFAULT 'PR-'"],
    ["quote_next_number","INT UNSIGNED NOT NULL DEFAULT 1"],
    ["job_prefix","VARCHAR(20) NOT NULL DEFAULT 'TR-'"],
    ["job_next_number","INT UNSIGNED NOT NULL DEFAULT 1"],
    ["quote_validity_days","INT UNSIGNED NOT NULL DEFAULT 15"],
    ["quote_default_notes","TEXT"],
    ["quote_terms","TEXT"],
    ["commercial_conditions","TEXT"]
  ];
  for (const [name, definition] of columns) {
    await pool.query(`ALTER TABLE business_settings ADD COLUMN ${name} ${definition}`).catch(error => {
      if (!/Duplicate column name/i.test(error.message)) throw error;
    });
  }

  await pool.query(`
    INSERT INTO business_settings
      (id, business_name, phone, whatsapp, email, pdf_footer,
       currency_code, currency_symbol, quote_prefix, job_prefix)
    VALUES
      (1, 'JR Electricidad', '3385684660', '3385684660',
       'jorge9609@hotmail.com',
       'JR Electricidad · Electricista Matriculado Cat. 3',
       'ARS', '

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
        whatsapp_enabled: Boolean(req.body.whatsapp_enabled),
        whatsapp_auto_notifications: Boolean(req.body.whatsapp_auto_notifications),
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
            whatsapp_enabled=?, whatsapp_auto_notifications=?,
            email=?, address=?, city=?, hours=?, logo_url=?,
            pdf_footer=?, pdf_notes=?
        WHERE id=1
        `,
        [
          fields.business_name,
          fields.legal_name,
          fields.phone,
          fields.whatsapp,
          fields.whatsapp_enabled ? 1 : 0,
          fields.whatsapp_auto_notifications ? 1 : 0,
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
  async (req, res) => {
    if (!req.session.user) return res.json({ user: null });

    try {
      const [rows] = await pool.query(
        `SELECT id, name, email, role, email_verified_at, pending_email, avatar_url, totp_enabled
         FROM users WHERE id=? LIMIT 1`,
        [Number(req.session.user.id)]
      );
      if (!rows.length) return res.json({ user: null });

      req.session.user = {
        ...req.session.user,
        id: rows[0].id,
        name: rows[0].name,
        email: rows[0].email,
        role: rows[0].role
      };

      res.json({ user: cleanUser(rows[0]) });
    } catch (error) {
      logError("Error obteniendo usuario actual", { requestId: req.requestId, error: error.message });
      res.status(500).json({ error: "No se pudo obtener la cuenta." });
    }
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

      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({ error: passwordError });
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
      await registerActiveSession(req, result.insertId);
      await writeAudit(req, "register", "user", result.insertId);
      try {
        await sendEmailVerification(result.insertId, normalized);
      } catch (mailError) {
        logError("No se pudo enviar verificación tras registro", {
          requestId: req.requestId,
          userId: result.insertId,
          error: mailError.message
        });
      }

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
            created_at,
            email_verified_at,
            avatar_url,
            totp_enabled
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
    const userId = req.session?.user?.id || null;
    const sessionId = req.sessionID;

    req.session.destroy(
      () => {
        removeActiveSession(sessionId);
        if (userId) {
          writeAudit(req, "logout", "user", userId);
        }

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
        password.length < PASSWORD_MIN ||
        password.length > PASSWORD_MAX
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

    // V2: vincular automáticamente la solicitud con un cliente existente.
    let clientId = null;
    const clientQuery = await pool.query("SELECT id FROM clients WHERE phone=? LIMIT 1", [cleanPhone]);
    const clientRows = clientQuery[0];
    if (clientRows.length) {
      clientId = clientRows[0].id;
      await pool.query(
        `UPDATE clients SET name=?, email=COALESCE(NULLIF(?, ''), email) WHERE id=?`,
        [cleanName, cleanEmail || "", clientId]
      );
    } else {
      const clientQueryResult = await pool.query(
        `INSERT INTO clients (name, phone, email) VALUES (?, ?, ?)`,
        [cleanName, cleanPhone, cleanEmail || null]
      );
      clientId = clientQueryResult[0].insertId;
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
        image_url,
        client_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        cleanName,
        cleanPhone,
        cleanEmail,
        cleanService,
        cleanDescription,
        preferred_date || null,
        imageUrl,
        clientId
      ]
    );

    // La solicitud ya fue guardada correctamente. La notificación
    // nunca debe hacer fallar el envío de la solicitud.
    try {
      await createAdminNotification({
        type: "quote_request_created",
        message: `Nueva solicitud de presupuesto de ${cleanName}.`,
        entityType: "quote_request",
        entityId: result.insertId,
        linkUrl: "/admin.html#quoteRequestsSection",
        priority: "high"
      });
    } catch (notificationError) {
      logError("Solicitud guardada, pero no se pudo crear la notificación", {
        requestId: req.requestId,
        error: notificationError.message
      });
    }

    const [createdRequestRows] = await pool.query(
      "SELECT id,name,email,phone,whatsapp,service,status FROM quote_requests WHERE id=? LIMIT 1",
      [result.insertId]
    );
    if (createdRequestRows.length) {
      await notifyRequestCustomer(
        createdRequestRows[0],
        "Solicitud recibida - JR Electricidad",
        "Recibimos correctamente tu solicitud de presupuesto."
      );
      await notifyRequestWhatsApp(
        createdRequestRows[0],
        `JR Electricidad: recibimos tu solicitud #${createdRequestRows[0].id}. Te contactaremos luego de revisarla.`
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
// GALERÍA V2 — PÚBLICA + ADMIN
// =========================================================

const GALLERY_CATEGORIES = [
  "instalaciones",
  "reparaciones",
  "tableros",
  "iluminacion",
  "mantenimiento",
  "otros"
];

function parseOptionalId(value) {
  if (value === "" || value === null || value === undefined) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateGalleryCategory(value) {
  const category = String(value || "otros").trim().toLowerCase();
  return GALLERY_CATEGORIES.includes(category) ? category : null;
}

function galleryCategoryLabel(category) {
  return ({
    instalaciones: "Instalaciones",
    reparaciones: "Reparaciones",
    tableros: "Tableros eléctricos",
    iluminacion: "Iluminación",
    mantenimiento: "Mantenimiento",
    otros: "Otros"
  })[category] || "Otros";
}

async function validateGalleryRelations({ clientId, jobId, quoteId }) {
  if (clientId !== null) {
    const [rows] = await pool.query("SELECT id FROM clients WHERE id=? LIMIT 1", [clientId]);
    if (!rows.length) return "El cliente vinculado no existe.";
  }
  if (quoteId !== null) {
    const [rows] = await pool.query("SELECT id, quote_request_id FROM quotes WHERE id=? LIMIT 1", [quoteId]);
    if (!rows.length) return "El presupuesto vinculado no existe.";
  }
  if (jobId !== null) {
    const [rows] = await pool.query(
      "SELECT j.id, j.status, j.quote_id FROM jobs j WHERE j.id=? LIMIT 1",
      [jobId]
    );
    if (!rows.length) return "El trabajo vinculado no existe.";
    if (!["finalizado", "cerrado"].includes(rows[0].status)) {
      return "Solo se pueden publicar trabajos de la galería vinculados a trabajos finalizados o cerrados.";
    }
  }
  if (jobId !== null && quoteId !== null) {
    const [rows] = await pool.query("SELECT id FROM jobs WHERE id=? AND quote_id=? LIMIT 1", [jobId, quoteId]);
    if (!rows.length) return "El trabajo y el presupuesto vinculados no corresponden entre sí.";
  }
  if (jobId !== null && clientId !== null) {
    const [rows] = await pool.query(
      "SELECT j.id FROM jobs j INNER JOIN quotes q ON q.id=j.quote_id INNER JOIN quote_requests qr ON qr.id=q.quote_request_id WHERE j.id=? AND qr.client_id=? LIMIT 1",
      [jobId, clientId]
    );
    if (!rows.length) return "El trabajo y el cliente vinculados no corresponden entre sí.";
  }
  return null;
}

async function deleteGalleryFile(imageUrl) {
  if (!imageUrl || !String(imageUrl).startsWith("/uploads/")) return;
  const imageFile = path.join(__dirname, "public", String(imageUrl).replace(/^\/+/, ""));
  if (fs.existsSync(imageFile)) await fs.promises.unlink(imageFile).catch(() => {});
}

app.get("/api/gallery", async (req, res) => {
  try {
    const category = String(req.query.category || "").trim().toLowerCase();
    const params = [];
    let sql = "SELECT id,title,description,image_url,alt_text,category,featured,sort_order,client_id,job_id,quote_id,created_at FROM gallery WHERE active=1";
    if (category && GALLERY_CATEGORIES.includes(category)) {
      sql += " AND category=?";
      params.push(category);
    }
    sql += " ORDER BY featured DESC,sort_order ASC,created_at DESC";
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo galería pública", {requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron cargar los trabajos."});
  }
});

app.get("/api/admin/gallery", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const category = String(req.query.category || "").trim().toLowerCase();
    const status = String(req.query.status || "").trim().toLowerCase();
    const params = [];
    let sql = "SELECT g.id,g.title,g.description,g.image_url,g.alt_text,g.active,g.featured,g.sort_order,g.category,g.client_id,g.job_id,g.quote_id,g.created_at,g.updated_at,c.name AS client_name,j.status AS job_status,q.quote_number FROM gallery g LEFT JOIN clients c ON c.id=g.client_id LEFT JOIN jobs j ON j.id=g.job_id LEFT JOIN quotes q ON q.id=g.quote_id WHERE 1=1";
    if (search) {
      const v = "%" + search + "%";
      sql += " AND (g.title LIKE ? OR g.description LIKE ? OR g.alt_text LIKE ? OR g.category LIKE ? OR c.name LIKE ? OR q.quote_number LIKE ?)";
      params.push(v,v,v,v,v,v);
    }
    if (category && GALLERY_CATEGORIES.includes(category)) {
      sql += " AND g.category=?";
      params.push(category);
    }
    if (status === "active") sql += " AND g.active=1";
    if (status === "inactive") sql += " AND g.active=0";
    if (status === "featured") sql += " AND g.featured=1";
    sql += " ORDER BY g.sort_order ASC,g.created_at DESC";
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo galería admin", {requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron cargar los trabajos."});
  }
});

app.get("/api/admin/gallery/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query(
      "SELECT g.*,c.name AS client_name,j.status AS job_status,q.quote_number FROM gallery g LEFT JOIN clients c ON c.id=g.client_id LEFT JOIN jobs j ON j.id=g.job_id LEFT JOIN quotes q ON q.id=g.quote_id WHERE g.id=? LIMIT 1",
      [id]
    );
    if (!rows.length) return res.status(404).json({error:"Trabajo de galería no encontrado."});
    res.json(rows[0]);
  } catch (error) {
    logError("Error obteniendo detalle de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el trabajo de galería."});
  }
});

app.post("/api/admin/gallery", requireAdmin, adminMutationLimiter, upload.single("image"), validateUploadedImage, async (req, res) => {
  try {
    const title=String(req.body.title||"").trim();
    const description=String(req.body.description||"").trim();
    const altText=String(req.body.alt_text||req.body.altText||title).trim();
    const category=validateGalleryCategory(req.body.category);
    const active=["true","1"].includes(String(req.body.active))?1:0;
    const featured=["true","1"].includes(String(req.body.featured))?1:0;
    const clientId=parseOptionalId(req.body.client_id);
    const jobId=parseOptionalId(req.body.job_id);
    const quoteId=parseOptionalId(req.body.quote_id);

    if(!title||title.length>150){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El título es obligatorio y no puede superar 150 caracteres."});}
    if(description.length>500){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"La descripción no puede superar 500 caracteres."});}
    if(!altText||altText.length>255){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El texto alternativo es obligatorio y no puede superar 255 caracteres."});}
    if(!category){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"La categoría seleccionada no es válida."});}
    const relationError=await validateGalleryRelations({clientId,jobId,quoteId});
    if(relationError){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:relationError});}
    if(!req.file)return res.status(400).json({error:"Debes seleccionar una imagen."});

    const imageUrl="/uploads/"+req.file.filename;
    const [[orderRow]]=await pool.query("SELECT COALESCE(MAX(sort_order),0)+1 AS next_order FROM gallery");
    const sortOrder=Number(orderRow.next_order||1);
    const [result]=await pool.query(
      "INSERT INTO gallery (title,description,image_url,alt_text,category,active,featured,sort_order,client_id,job_id,quote_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [title,description,imageUrl,altText,category,active,featured,sortOrder,clientId,jobId,quoteId]
    );
    await writeAudit(req,"gallery_created","gallery",result.insertId,{category,featured,jobId,quoteId,clientId});
    if (active) {
      await createAdminNotification({
        type: "gallery_published",
        message: `La galería publicó "${title}".`,
        entityType: "gallery",
        entityId: result.insertId,
        quoteId,
        linkUrl: "/admin.html#gallerySection",
        priority: featured ? "high" : "normal"
      }).catch(() => {});
    }
    res.status(201).json({ok:true,message:"Trabajo agregado correctamente.",id:result.insertId,image_url:imageUrl});
  } catch(error) {
    if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});
    logError("Error agregando trabajo de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo agregar el trabajo."});
  }
});

app.put("/api/admin/gallery/:id(\\d+)", requireAdmin, adminMutationLimiter, upload.single("image"), validateUploadedImage, async (req, res) => {
  try {
    const id=Number(req.params.id);
    const [[existing]]=await pool.query("SELECT * FROM gallery WHERE id=? LIMIT 1",[id]);
    if(!existing){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(404).json({error:"Trabajo no encontrado."});}

    const title=String(req.body.title||"").trim();
    const description=String(req.body.description||"").trim();
    const altText=String(req.body.alt_text||req.body.altText||title).trim();
    const category=validateGalleryCategory(req.body.category);
    const active=["true","1"].includes(String(req.body.active))?1:0;
    const featured=["true","1"].includes(String(req.body.featured))?1:0;
    const clientId=parseOptionalId(req.body.client_id);
    const jobId=parseOptionalId(req.body.job_id);
    const quoteId=parseOptionalId(req.body.quote_id);

    if(!title||title.length>150){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El título es obligatorio y no puede superar 150 caracteres."});}
    if(description.length>500){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"La descripción no puede superar 500 caracteres."});}
    if(!altText||altText.length>255){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El texto alternativo es obligatorio y no puede superar 255 caracteres."});}
    if(!category){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"La categoría seleccionada no es válida."});}

    const relationError=await validateGalleryRelations({clientId,jobId,quoteId});
    if(relationError){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:relationError});}

    let imageUrl=existing.image_url;
    if(req.file)imageUrl="/uploads/"+req.file.filename;

    await pool.query(
      "UPDATE gallery SET title=?,description=?,image_url=?,alt_text=?,category=?,active=?,featured=?,client_id=?,job_id=?,quote_id=? WHERE id=?",
      [title,description,imageUrl,altText,category,active,featured,clientId,jobId,quoteId,id]
    );
    if(req.file&&existing.image_url!==imageUrl&&!existing.source_job_attachment_id)await deleteGalleryFile(existing.image_url);
    await writeAudit(req,"gallery_updated","gallery",id,{category,featured,jobId,quoteId,clientId});
    if (!Number(existing.active) && active) {
      await createAdminNotification({
        type: "gallery_published",
        message: `La galería publicó "${title}".`,
        entityType: "gallery",
        entityId: id,
        quoteId,
        linkUrl: "/admin.html#gallerySection",
        priority: featured ? "high" : "normal"
      }).catch(() => {});
    }
    res.json({ok:true,message:"Trabajo actualizado correctamente."});
  }catch(error){
    if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});
    logError("Error editando trabajo de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el trabajo."});
  }
});

app.delete("/api/admin/gallery/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req,res)=>{
  try{
    const id=Number(req.params.id);
    const [[existing]]=await pool.query("SELECT image_url,source_job_attachment_id FROM gallery WHERE id=? LIMIT 1",[id]);
    if(!existing)return res.status(404).json({error:"Trabajo no encontrado."});
    await pool.query("DELETE FROM gallery WHERE id=?",[id]);
    if(!existing.source_job_attachment_id)await deleteGalleryFile(existing.image_url);
    await writeAudit(req,"gallery_deleted","gallery",id);
    res.json({ok:true,message:"Trabajo eliminado correctamente."});
  }catch(error){
    logError("Error eliminando trabajo de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo eliminar el trabajo."});
  }
});

app.put("/api/admin/gallery/:id(\\d+)/order", requireAdmin, adminMutationLimiter, async (req,res)=>{
  try{
    const id=Number(req.params.id);
    const direction=String(req.body.direction||"");
    if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:"ID inválido."});
    if(!["up","down"].includes(direction))return res.status(400).json({error:"Dirección inválida."});
    const [[current]]=await pool.query("SELECT id,sort_order FROM gallery WHERE id=? LIMIT 1",[id]);
    if(!current)return res.status(404).json({error:"Trabajo no encontrado."});
    const comparison=direction==="up"?"<":">";
    const orderDirection=direction==="up"?"DESC":"ASC";
    const [[neighbor]]=await pool.query(
      "SELECT id,sort_order FROM gallery WHERE sort_order "+comparison+" ? ORDER BY sort_order "+orderDirection+", id "+orderDirection+" LIMIT 1",
      [current.sort_order]
    );
    if(!neighbor)return res.json({ok:true,message:direction==="up"?"Ya está primero.":"Ya está último."});
    await pool.query("UPDATE gallery SET sort_order=? WHERE id=?",[neighbor.sort_order,current.id]);
    await pool.query("UPDATE gallery SET sort_order=? WHERE id=?",[current.sort_order,neighbor.id]);
    await writeAudit(req,"gallery_reordered","gallery",id,{direction});
    res.json({ok:true,message:"Orden actualizado correctamente."});
  }catch(error){
    logError("Error cambiando orden de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo cambiar el orden."});
  }
});

app.post("/api/admin/gallery/from-job-attachment/:attachmentId(\\d+)", requireAdmin, adminMutationLimiter, async (req,res)=>{
  try{
    const attachmentId=Number(req.params.attachmentId);
    const [[attachment]]=await pool.query(
      "SELECT ja.*,j.status AS job_status,j.quote_id,qr.client_id,qr.service,qr.description,q.quote_number FROM job_attachments ja INNER JOIN jobs j ON j.id=ja.job_id INNER JOIN quotes q ON q.id=j.quote_id INNER JOIN quote_requests qr ON qr.id=q.quote_request_id WHERE ja.id=? LIMIT 1",
      [attachmentId]
    );
    if(!attachment)return res.status(404).json({error:"La evidencia no existe."});
    if(!["image/jpeg","image/png","image/webp","image/gif"].includes(attachment.mime_type))return res.status(400).json({error:"Solo se pueden publicar imágenes como trabajos de galería."});
    if(!["finalizado","cerrado"].includes(attachment.job_status))return res.status(400).json({error:"Solo se pueden publicar evidencias de trabajos finalizados o cerrados."});

    const title=String(req.body.title||attachment.service||"Trabajo realizado").trim();
    const description=String(req.body.description||attachment.description||"").trim();
    const altText=String(req.body.alt_text||title).trim();
    const category=validateGalleryCategory(req.body.category||"otros");
    const active=["true","1"].includes(String(req.body.active??"1"))?1:0;
    const featured=["true","1"].includes(String(req.body.featured))?1:0;
    if(!title||title.length>150)return res.status(400).json({error:"El título es obligatorio y no puede superar 150 caracteres."});
    if(description.length>500)return res.status(400).json({error:"La descripción no puede superar 500 caracteres."});
    if(!altText||altText.length>255)return res.status(400).json({error:"El texto alternativo no es válido."});
    if(!category)return res.status(400).json({error:"La categoría no es válida."});

    const [[duplicate]]=await pool.query("SELECT id FROM gallery WHERE job_id=? AND image_url=? LIMIT 1",[attachment.job_id,attachment.url]);
    if(duplicate)return res.status(409).json({error:"Esta evidencia ya está publicada en la galería.",id:duplicate.id});

    const [[orderRow]]=await pool.query("SELECT COALESCE(MAX(sort_order),0)+1 AS next_order FROM gallery");
    const [result]=await pool.query(
      "INSERT INTO gallery (title,description,image_url,alt_text,category,active,featured,sort_order,client_id,job_id,quote_id,source_job_attachment_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [title,description,attachment.url,altText,category,active,featured,Number(orderRow.next_order||1),attachment.client_id||null,attachment.job_id,attachment.quote_id,attachmentId]
    );
    await writeAudit(req,"gallery_promoted_from_job_attachment","gallery",result.insertId,{attachmentId,jobId:attachment.job_id});
    if (active) {
      await createAdminNotification({
        type: "gallery_published",
        message: `La evidencia del trabajo #${attachment.job_id} fue publicada en la galería.`,
        entityType: "gallery",
        entityId: result.insertId,
        quoteId: attachment.quote_id,
        linkUrl: "/admin.html#gallerySection",
        priority: featured ? "high" : "normal"
      }).catch(() => {});
    }
    res.status(201).json({ok:true,id:result.insertId,message:"La evidencia fue publicada en la galería."});
  }catch(error){
    logError("Error promocionando evidencia a galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo publicar la evidencia en la galería."});
  }
});

app.get("/api/admin/gallery/categories", requireAdmin, (req,res)=>{
  res.json(GALLERY_CATEGORIES.map(value=>({value,label:galleryCategoryLabel(value)})));
});

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
// ADMIN - CLIENTES V2
// =========================================================

function cleanClientInput(body) {
  return {
    name: String(body.name || "").trim(),
    phone: String(body.phone || "").trim(),
    whatsapp: String(body.whatsapp || "").trim(),
    email: normalizeEmail(body.email),
    address: String(body.address || "").trim(),
    locality: String(body.locality || "").trim(),
    notes: String(body.notes || "").trim()
  };
}

function validateClientInput(client) {
  if (!client.name || client.name.length > 150) return "El nombre es obligatorio y no puede superar 150 caracteres.";
  if (!client.phone || client.phone.length > 50) return "El teléfono es obligatorio y no puede superar 50 caracteres.";
  if (client.whatsapp.length > 50) return "El WhatsApp no puede superar 50 caracteres.";
  if (client.email && !validEmail(client.email)) return "El email del cliente no es válido.";
  if (client.address.length > 255) return "La dirección no puede superar 255 caracteres.";
  if (client.locality.length > 120) return "La localidad no puede superar 120 caracteres.";
  if (client.notes.length > 5000) return "Las notas no pueden superar 5000 caracteres.";
  return null;
}

app.get("/api/admin/clients", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const locality = String(req.query.locality || "").trim();
    const params = [];
    let sql = `
      SELECT
        c.id, c.user_id, c.name, c.phone, c.whatsapp, c.email,
        c.address, c.locality, c.notes, c.created_at, c.updated_at,
        COUNT(DISTINCT qr.id) AS requests,
        COUNT(DISTINCT q.id) AS quotes,
        COUNT(DISTINCT j.id) AS jobs,
        MAX(COALESCE(j.updated_at, q.updated_at, qr.created_at, c.updated_at)) AS last_activity
      FROM clients c
      LEFT JOIN quote_requests qr ON qr.client_id=c.id
      LEFT JOIN quotes q ON q.quote_request_id=qr.id
      LEFT JOIN jobs j ON j.quote_id=q.id
      WHERE 1=1
    `;

    if (search) {
      sql += ` AND (c.name LIKE ? OR c.phone LIKE ? OR c.whatsapp LIKE ? OR c.email LIKE ? OR c.address LIKE ? OR c.locality LIKE ?) `;
      const v = `%${search}%`;
      params.push(v,v,v,v,v,v);
    }
    if (locality) {
      sql += " AND c.locality LIKE ?";
      params.push(`%${locality}%`);
    }

    sql += `
      GROUP BY c.id
      ORDER BY last_activity DESC, c.name ASC
    `;

    const [rows] = await pool.query(sql, params);
    res.json({
      success: true,
      clients: rows.map(c => ({
        ...c,
        requests: Number(c.requests || 0),
        quotes: Number(c.quotes || 0),
        jobs: Number(c.jobs || 0)
      }))
    });
  } catch (error) {
    logError("Error obteniendo clientes", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener los clientes." });
  }
});

app.post("/api/admin/clients", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const client = cleanClientInput(req.body);
    const validationError = validateClientInput(client);
    if (validationError) return res.status(400).json({ error: validationError });

    const [existing] = await pool.query("SELECT id FROM clients WHERE phone=? LIMIT 1", [client.phone]);
    if (existing.length) return res.status(409).json({ error: "Ya existe un cliente con ese teléfono." });

    const [result] = await pool.query(
      `INSERT INTO clients (name,phone,whatsapp,email,address,locality,notes)
       VALUES (?,?,?,?,?,?,?)`,
      [client.name,client.phone,client.whatsapp||null,client.email||null,client.address||null,client.locality||null,client.notes||null]
    );
    await writeAudit(req, "client_created", "client", result.insertId);
    res.status(201).json({ success:true, client:{ id:result.insertId, ...client } });
  } catch (error) {
    logError("Error creando cliente", { requestId:req.requestId, error:error.message });
    res.status(500).json({ error:"No se pudo crear el cliente." });
  }
});

app.get("/api/admin/clients/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id=Number(req.params.id);
    if (!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de cliente inválido."});
    const [rows]=await pool.query("SELECT * FROM clients WHERE id=? LIMIT 1",[id]);
    if (!rows.length) return res.status(404).json({error:"Cliente no encontrado."});
    res.json({success:true,client:rows[0]});
  } catch(error) {
    logError("Error obteniendo cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el cliente."});
  }
});

app.put("/api/admin/clients/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const id=Number(req.params.id);
    if (!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de cliente inválido."});
    const client=cleanClientInput(req.body);
    const validationError=validateClientInput(client);
    if (validationError) return res.status(400).json({error:validationError});

    const [existing]=await pool.query("SELECT id FROM clients WHERE phone=? AND id<>? LIMIT 1",[client.phone,id]);
    if(existing.length) return res.status(409).json({error:"Ya existe otro cliente con ese teléfono."});

    const [result]=await pool.query(
      `UPDATE clients SET name=?,phone=?,whatsapp=?,email=?,address=?,locality=?,notes=? WHERE id=?`,
      [client.name,client.phone,client.whatsapp||null,client.email||null,client.address||null,client.locality||null,client.notes||null,id]
    );
    if(!result.affectedRows) return res.status(404).json({error:"Cliente no encontrado."});
    await writeAudit(req,"client_updated","client",id);
    const [rows]=await pool.query("SELECT * FROM clients WHERE id=? LIMIT 1",[id]);
    res.json({success:true,message:"Cliente actualizado correctamente.",client:rows[0]});
  } catch(error) {
    logError("Error actualizando cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el cliente."});
  }
});

app.delete("/api/admin/clients/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de cliente inválido."});
    const [result]=await pool.query("DELETE FROM clients WHERE id=?",[id]);
    if(!result.affectedRows) return res.status(404).json({error:"Cliente no encontrado."});
    await writeAudit(req,"client_deleted","client",id);
    res.json({success:true,message:"Cliente eliminado correctamente."});
  } catch(error) {
    logError("Error eliminando cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo eliminar el cliente."});
  }
});

app.get("/api/admin/clients/:id(\\d+)/history", requireAdmin, async (req, res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de cliente inválido."});

    const [clientRows]=await pool.query("SELECT * FROM clients WHERE id=? LIMIT 1",[id]);
    if(!clientRows.length) return res.status(404).json({error:"Cliente no encontrado."});

    const [requests]=await pool.query(
      `SELECT id,name,phone,email,service,description,preferred_date,image_url,status,created_at
       FROM quote_requests WHERE client_id=? ORDER BY created_at DESC`,[id]
    );
    const [quotes]=await pool.query(
      `SELECT q.id,q.quote_number,q.issue_date,q.expiration_date,q.status,q.subtotal,q.discount,q.total,
              q.created_at,q.updated_at,j.id AS job_id,j.status AS job_status,j.started_at,j.completed_at
       FROM quotes q
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       LEFT JOIN jobs j ON j.quote_id=q.id
       WHERE qr.client_id=? ORDER BY q.created_at DESC`,[id]
    );
    const [jobs]=await pool.query(
      `SELECT j.id,j.quote_id,j.status,j.started_at,j.completed_at,j.created_at,j.updated_at,
              q.quote_number, q.total,
              qr.service,qr.description
       FROM jobs j
       INNER JOIN quotes q ON q.id=j.quote_id
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE qr.client_id=? ORDER BY j.created_at DESC`,[id]
    );

    res.json({
      success:true,
      client:clientRows[0],
      requests,quotes,jobs,
      summary:{
        requests:requests.length,
        quotes:quotes.length,
        jobs:jobs.length,
        completedJobs:jobs.filter(j=>j.status==="cerrado").length,
        totalQuoted:quotes.reduce((sum,q)=>sum+Number(q.total||0),0)
      }
    });
  } catch(error) {
    logError("Error obteniendo historial del cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el historial del cliente."});
  }
});

// Compatibilidad V1: ficha por teléfono/email.
app.get("/api/admin/clients/detail", requireAdmin, async (req,res)=>{
  try {
    const phone=String(req.query.phone||"").trim();
    const email=normalizeEmail(req.query.email);
    if(!phone) return res.status(400).json({error:"El teléfono del cliente es obligatorio."});
    const [rows]=await pool.query("SELECT id FROM clients WHERE phone=? LIMIT 1",[phone]);
    if(!rows.length) return res.status(404).json({error:"No se encontró el cliente."});
    const id=rows[0].id;
    const [clientRows]=await pool.query("SELECT * FROM clients WHERE id=? LIMIT 1",[id]);
    const [requests]=await pool.query("SELECT id,name,phone,email,service,description,preferred_date,image_url,status,created_at FROM quote_requests WHERE client_id=? ORDER BY created_at DESC",[id]);
    const [quotes]=await pool.query(
      `SELECT q.id,q.quote_number,q.issue_date,q.expiration_date,q.status,q.subtotal,q.discount,q.total,q.created_at,q.updated_at,
              j.id AS job_id,j.status AS job_status,j.started_at,j.completed_at
       FROM quotes q INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       LEFT JOIN jobs j ON j.quote_id=q.id WHERE qr.client_id=? ORDER BY q.created_at DESC`,[id]
    );
    res.json({success:true,client:clientRows[0],requests,quotes});
  } catch(error) {
    logError("Error obteniendo ficha compatible del cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener la ficha del cliente."});
  }
});

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

      const [[clientsSummary]] = await pool.query(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN 1 ELSE 0 END) AS newClients
         FROM clients`,
        [days]
      );

      const [[gallerySummary]] = await pool.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) AS published,
                SUM(CASE WHEN featured=1 AND active=1 THEN 1 ELSE 0 END) AS featured
         FROM gallery`
      );

      const [[requestPipeline]] = await pool.query(
        `SELECT
          SUM(CASE WHEN status='pendiente' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status='en_revision' THEN 1 ELSE 0 END) AS review,
          SUM(CASE WHEN status='presupuestando' THEN 1 ELSE 0 END) AS quoting,
          SUM(CASE WHEN status='presupuestada' THEN 1 ELSE 0 END) AS quoted,
          SUM(CASE WHEN status='aceptada' THEN 1 ELSE 0 END) AS accepted
         FROM quote_requests`
      );

      const [upcomingJobs] = await pool.query(
        `SELECT j.id,j.status,j.scheduled_at,j.location,
                COALESCE(c.name,qr.name,'Sin cliente') AS client_name,
                u.name AS technician_name
         FROM jobs j
         LEFT JOIN clients c ON c.id=j.client_id
         LEFT JOIN quote_requests qr ON qr.id=j.quote_request_id
         LEFT JOIN users u ON u.id=j.assigned_user_id
         WHERE j.scheduled_at IS NOT NULL
           AND j.scheduled_at >= NOW()
           AND j.status IN ('aceptado','programado','en_proceso','pausado')
         ORDER BY j.scheduled_at ASC
         LIMIT 8`
      );

      const [topServices] = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(qr.service),''),'Sin servicio') AS service,
                COUNT(*) AS requests,
                SUM(CASE WHEN qr.status='aceptada' THEN 1 ELSE 0 END) AS accepted
         FROM quote_requests qr
         GROUP BY COALESCE(NULLIF(TRIM(qr.service),''),'Sin servicio')
         ORDER BY requests DESC, accepted DESC
         LIMIT 6`
      );

      const [jobStatusSummary] = await pool.query(
        `SELECT status,COUNT(*) AS total
         FROM jobs
         GROUP BY status
         ORDER BY total DESC`
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
        recentActivity,
        clients: {
          total: Number(clientsSummary.total || 0),
          newClients: Number(clientsSummary.newClients || 0)
        },
        gallery: {
          total: Number(gallerySummary.total || 0),
          published: Number(gallerySummary.published || 0),
          featured: Number(gallerySummary.featured || 0)
        },
        requestPipeline: {
          pending: Number(requestPipeline.pending || 0),
          review: Number(requestPipeline.review || 0),
          quoting: Number(requestPipeline.quoting || 0),
          quoted: Number(requestPipeline.quoted || 0),
          accepted: Number(requestPipeline.accepted || 0)
        },
        upcomingJobs: upcomingJobs.map(row => ({
          id: Number(row.id),
          status: row.status,
          scheduledAt: row.scheduled_at,
          location: row.location,
          clientName: row.client_name,
          technicianName: row.technician_name
        })),
        topServices: topServices.map(row => ({
          service: row.service,
          requests: Number(row.requests || 0),
          accepted: Number(row.accepted || 0)
        })),
        jobStatusSummary: jobStatusSummary.map(row => ({
          status: row.status,
          total: Number(row.total || 0)
        }))
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
// V2 — SESIONES ACTIVAS
// =========================================================

app.get("/api/account/sessions", requireAuth, async (req, res) => {
  try {
    await registerActiveSession(req, req.session.user.id);
    const [rows] = await pool.query(
      `SELECT id, ip_address, user_agent, created_at, last_seen_at,
              session_id = ? AS current_session
       FROM active_sessions
       WHERE user_id=?
       ORDER BY last_seen_at DESC`,
      [req.sessionID, req.session.user.id]
    );

    res.json({
      success: true,
      sessions: rows.map(row => ({
        id: row.id,
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        created_at: row.created_at,
        last_seen_at: row.last_seen_at,
        current: Boolean(row.current_session)
      }))
    });
  } catch (error) {
    logError("Error listando sesiones", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudieron obtener las sesiones." });
  }
});

app.delete("/api/account/sessions/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: "Sesión inválida." });

    const [rows] = await pool.query(
      "SELECT session_id, user_id FROM active_sessions WHERE id=? AND user_id=? LIMIT 1",
      [id, req.session.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: "Sesión no encontrada." });
    if (rows[0].session_id === req.sessionID) {
      return res.status(400).json({ success: false, error: "No podés cerrar la sesión actual desde este listado." });
    }

    await pool.query("DELETE FROM sessions WHERE session_id=?", [rows[0].session_id]);
    await pool.query("DELETE FROM active_sessions WHERE id=?", [id]);
    await writeAudit(req, "session_revoked", "session", id);
    res.json({ success: true, message: "Sesión cerrada correctamente." });
  } catch (error) {
    logError("Error revocando sesión", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo cerrar la sesión." });
  }
});

app.post("/api/account/sessions/revoke-others", requireAuth, async (req, res) => {
  try {
    await removeAllActiveSessions(req.session.user.id, req.sessionID);
    await pool.query(
      "DELETE FROM sessions WHERE session_id <> ? AND data LIKE ?",
      [req.sessionID, '%"user":{"id":' + Number(req.session.user.id) + ',%']
    );
    await writeAudit(req, "sessions_revoked_others", "user", req.session.user.id);
    res.json({ success: true, message: "Las demás sesiones fueron cerradas." });
  } catch (error) {
    logError("Error cerrando sesiones", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudieron cerrar las demás sesiones." });
  }
});

// =========================================================
// V2 — 2FA TOTP PARA ADMIN
// =========================================================

app.get("/api/account/2fa/status", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT role, totp_enabled FROM users WHERE id=? LIMIT 1", [req.session.user.id]);
    res.json({ success: true, enabled: Boolean(rows[0]?.totp_enabled), required: rows[0]?.role === "admin" });
  } catch (error) {
    res.status(500).json({ success: false, error: "No se pudo consultar 2FA." });
  }
});

app.post("/api/account/2fa/setup", requireAuth, authLimiter, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const [rows] = await pool.query("SELECT password_hash, role, totp_enabled FROM users WHERE id=? LIMIT 1", [req.session.user.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: "Usuario no encontrado." });
    if (rows[0].role !== "admin") return res.status(403).json({ success: false, error: "2FA está reservado para administradores." });
    if (rows[0].totp_enabled) return res.status(400).json({ success: false, error: "2FA ya está habilitado." });
    if (!await bcrypt.compare(currentPassword, rows[0].password_hash)) return res.status(401).json({ success: false, error: "La contraseña actual es incorrecta." });

    const secret = generateTotpSecret();
    const encrypted = encryptSecret(secret, process.env.SESSION_SECRET);
    await pool.query("UPDATE users SET totp_secret=? WHERE id=?", [encrypted, req.session.user.id]);

    const issuer = "JR Electricidad";
    const label = `${issuer}:${req.session.user.email}`;
    const otpauth = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    res.json({ success: true, secret, otpauth_uri: otpauth });
  } catch (error) {
    logError("Error preparando 2FA", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo preparar 2FA." });
  }
});

app.post("/api/account/2fa/enable", requireAuth, authLimiter, async (req, res) => {
  try {
    const code = String(req.body.code || "");
    const [rows] = await pool.query("SELECT totp_secret, totp_enabled, role FROM users WHERE id=? LIMIT 1", [req.session.user.id]);
    if (!rows.length || rows[0].role !== "admin") return res.status(403).json({ success: false, error: "Acceso no autorizado." });
    if (rows[0].totp_enabled) return res.status(400).json({ success: false, error: "2FA ya está habilitado." });
    if (!rows[0].totp_secret) return res.status(400).json({ success: false, error: "Primero generá la configuración de 2FA." });

    const secret = decryptSecret(rows[0].totp_secret, process.env.SESSION_SECRET);
    if (!verifyTotp(secret, code)) return res.status(401).json({ success: false, error: "Código 2FA inválido." });

    const backupCodes = generateBackupCodes();
    await pool.query("DELETE FROM mfa_backup_codes WHERE user_id=?", [req.session.user.id]);
    for (const backup of backupCodes) {
      await pool.query("INSERT INTO mfa_backup_codes (user_id, code_hash) VALUES (?, ?)", [req.session.user.id, hashBackupCode(backup)]);
    }
    await pool.query("UPDATE users SET totp_enabled=1 WHERE id=?", [req.session.user.id]);
    await writeAudit(req, "2fa_enabled", "user", req.session.user.id);

    res.json({ success: true, message: "2FA habilitado correctamente.", backup_codes: backupCodes });
  } catch (error) {
    logError("Error habilitando 2FA", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo habilitar 2FA." });
  }
});

app.post("/api/account/2fa/disable", requireAuth, authLimiter, async (req, res) => {
  try {
    const password = String(req.body.password || "");
    const code = String(req.body.code || "");
    const [rows] = await pool.query("SELECT password_hash, totp_secret, totp_enabled, role FROM users WHERE id=? LIMIT 1", [req.session.user.id]);
    if (!rows.length || rows[0].role !== "admin") return res.status(403).json({ success: false, error: "Acceso no autorizado." });
    if (!rows[0].totp_enabled) return res.status(400).json({ success: false, error: "2FA no está habilitado." });
    if (!await bcrypt.compare(password, rows[0].password_hash)) return res.status(401).json({ success: false, error: "La contraseña actual es incorrecta." });

    const secret = decryptSecret(rows[0].totp_secret, process.env.SESSION_SECRET);
    if (!verifyTotp(secret, code)) return res.status(401).json({ success: false, error: "Código 2FA inválido." });

    await pool.query("UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?", [req.session.user.id]);
    await pool.query("DELETE FROM mfa_backup_codes WHERE user_id=?", [req.session.user.id]);
    await writeAudit(req, "2fa_disabled", "user", req.session.user.id);
    res.json({ success: true, message: "2FA deshabilitado correctamente." });
  } catch (error) {
    logError("Error deshabilitando 2FA", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo deshabilitar 2FA." });
  }
});

app.post("/api/login/2fa", authLimiter, async (req, res) => {
  try {
    const pending = req.session.pending2fa;
    if (!pending || Date.now() - pending.createdAt > 5 * 60 * 1000) {
      return res.status(401).json({ success: false, error: "El desafío 2FA venció. Iniciá sesión nuevamente." });
    }

    const code = String(req.body.code || "").trim();
    const [rows] = await pool.query("SELECT id,name,email,role,totp_secret,totp_enabled FROM users WHERE id=? LIMIT 1", [pending.userId]);
    if (!rows.length || rows[0].role !== "admin" || !rows[0].totp_enabled) {
      return res.status(401).json({ success: false, error: "Desafío 2FA inválido." });
    }

    const secret = decryptSecret(rows[0].totp_secret, process.env.SESSION_SECRET);
    let valid = verifyTotp(secret, code);
    if (!valid && code) {
      const hash = hashBackupCode(code);
      const [codes] = await pool.query("SELECT id FROM mfa_backup_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL LIMIT 1", [pending.userId, hash]);
      if (codes.length) {
        await pool.query("UPDATE mfa_backup_codes SET used_at=NOW() WHERE id=?", [codes[0].id]);
        valid = true;
      }
    }

    if (!valid) {
      await writeAudit(req, "2fa_failed", "user", pending.userId);
      return res.status(401).json({ success: false, error: "Código 2FA inválido." });
    }

    const user = { id: rows[0].id, name: rows[0].name, email: rows[0].email, role: rows[0].role };
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.user = user;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    await registerActiveSession(req, user.id);
    await writeAudit(req, "login", "user", user.id, { mfa: true });
    res.json({ success: true, ok: true, user: cleanUser(user) });
  } catch (error) {
    logError("Error verificando 2FA", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo verificar 2FA." });
  }
});

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

  await pool.query(
    "DELETE FROM active_sessions WHERE last_seen_at < DATE_SUB(NOW(), INTERVAL 8 HOUR)"
  ).catch(error => {
    logError("No se pudieron limpiar sesiones activas vencidas", { error: error.message });
  });

  try {

    await pool.query(
      "SELECT 1"
    );


    console.log(
      "✅ MySQL conectado"
    );
	// =====================================================
// =====================================================
// FASE 8 — GESTIÓN AVANZADA DE TRABAJOS
// =====================================================

const JOB_STATUSES = [
  "pendiente_presupuesto",
  "presupuesto_enviado",
  "aceptado",
  "programado",
  "en_proceso",
  "pausado",
  "finalizado",
  "cerrado",
  "rechazado",
  "cancelado"
];

const JOB_TRANSITIONS = {
  pendiente_presupuesto:["presupuesto_enviado","rechazado","cancelado"],
  presupuesto_enviado:["aceptado","rechazado","cancelado"],
  aceptado:["programado","en_proceso","cancelado"],
  programado:["en_proceso","cancelado"],
  en_proceso:["pausado","finalizado","cancelado"],
  pausado:["en_proceso","cancelado"],
  finalizado:["cerrado"],
  cerrado:[],
  rechazado:[],
  cancelado:[]
};

const jobUpload = multer({
  storage,
  limits:{fileSize:10*1024*1024},
  fileFilter:(req,file,cb)=>{
    const allowed=[
      "image/jpeg","image/png","image/webp","image/gif",
      "application/pdf","text/plain",
      "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ];
    if(!allowed.includes(file.mimetype)) return cb(new Error("Tipo de archivo no permitido."));
    cb(null,true);
  }
});

function validateJobId(value){
  const id=Number(value);
  return Number.isInteger(id)&&id>0?id:null;
}

function validateJobStatus(value){
  const status=String(value||"").trim();
  return JOB_STATUSES.includes(status)?status:null;
}

function validateJobDateTime(value){
  if(value==null||String(value).trim()==="") return null;
  const text=String(value).trim();
  if(!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(text)) return undefined;
  return text.replace("T"," ");
}

async function recordJobHistory(req,jobId,action,oldStatus=null,newStatus=null,metadata=null,db=pool){
  await db.query(
    `INSERT INTO job_history
      (job_id,actor_user_id,action,old_status,new_status,metadata)
     VALUES (?,?,?,?,?,?)`,
    [jobId,req.session?.user?.id||null,action,oldStatus,newStatus,metadata?JSON.stringify(metadata):null]
  );
}

async function createJobNotification(type,quoteId,message,jobId,userId=null,priority="normal"){
  try {
    await createAdminNotification({
      type,
      quoteId,
      message,
      userId,
      entityType: "job",
      entityId: jobId,
      linkUrl: "/admin.html#jobsSection",
      priority
    });
  } catch(error) {
    logError("No se pudo crear notificación de trabajo",{error:error.message,quoteId,jobId,userId});
  }
}

// Lista de trabajos.
app.get("/api/admin/jobs",requireAdmin,async(req,res)=>{
  try{
    const search=String(req.query.search||"").trim();
    const status=String(req.query.status||"").trim();
    const assignedUserId=String(req.query.assigned_user_id||"").trim();
    const dateFrom=String(req.query.date_from||"").trim();
    const dateTo=String(req.query.date_to||"").trim();

    if(status&&!validateJobStatus(status)) return res.status(400).json({error:"Estado de trabajo inválido."});

    const params=[];
    let sql=`
      SELECT j.id,j.quote_id,j.status,j.started_at,j.completed_at,j.created_at,j.updated_at,
             j.assigned_user_id,j.scheduled_at,j.internal_notes,j.execution_notes,j.completion_notes,j.location,
             q.quote_number,q.issue_date,q.subtotal,q.discount,q.total,q.notes,
             qr.name AS client_name,qr.phone AS client_phone,qr.email AS client_email,
             qr.service AS requested_service,qr.description AS work_description,qr.preferred_date,
             u.name AS assigned_user_name
      FROM jobs j
      INNER JOIN quotes q ON q.id=j.quote_id
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN users u ON u.id=j.assigned_user_id
      WHERE 1=1`;

    if(search){
      const v=`%${search}%`;
      sql+=` AND (qr.name LIKE ? OR qr.phone LIKE ? OR qr.email LIKE ? OR q.quote_number LIKE ? OR qr.service LIKE ? OR qr.description LIKE ?)`;
      params.push(v,v,v,v,v,v);
    }
    if(status){sql+=" AND j.status=?";params.push(status);}
    if(assignedUserId){
      const id=Number(assignedUserId);
      if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:"Técnico inválido."});
      sql+=" AND j.assigned_user_id=?";params.push(id);
    }
    if(dateFrom){if(!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom))return res.status(400).json({error:"Fecha desde inválida."});sql+=" AND DATE(COALESCE(j.scheduled_at,j.created_at))>=?";params.push(dateFrom);}
    if(dateTo){if(!/^\d{4}-\d{2}-\d{2}$/.test(dateTo))return res.status(400).json({error:"Fecha hasta inválida."});sql+=" AND DATE(COALESCE(j.scheduled_at,j.created_at))<=?";params.push(dateTo);}
    sql+=" ORDER BY FIELD(j.status,'programado','en_proceso','pausado','finalizado','aceptado','pendiente_presupuesto','presupuesto_enviado','cerrado','rechazado','cancelado'),COALESCE(j.scheduled_at,j.created_at) ASC,j.id DESC";

    const [jobs]=await pool.query(sql,params);
    res.json({success:true,jobs});
  }catch(error){
    logError("Error obteniendo trabajos V2",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron obtener los trabajos."});
  }
});

// Detalle completo.
app.get("/api/admin/jobs/:id(\\d+)",requireAdmin,async(req,res)=>{
  try{
    const id=validateJobId(req.params.id);
    if(!id)return res.status(400).json({error:"ID de trabajo inválido."});
    const [rows]=await pool.query(`
      SELECT j.*,q.quote_number,q.issue_date,q.expiration_date,q.notes,q.subtotal,q.discount,q.total,
             qr.name AS client_name,qr.phone AS client_phone,qr.email AS client_email,
             qr.service AS requested_service,qr.description AS work_description,qr.preferred_date,
             c.address AS client_address,c.locality AS client_locality,u.name AS assigned_user_name
      FROM jobs j
      INNER JOIN quotes q ON q.id=j.quote_id
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN clients c ON c.id=qr.client_id
      LEFT JOIN users u ON u.id=j.assigned_user_id
      WHERE j.id=? LIMIT 1`,[id]);
    if(!rows.length)return res.status(404).json({error:"Trabajo no encontrado."});

    const [items]=await pool.query("SELECT id,description,quantity,unit,unit_price,total FROM quote_items WHERE quote_id=? ORDER BY id",[rows[0].quote_id]);
    const [history]=await pool.query(`
      SELECT h.*,u.name AS actor_name FROM job_history h
      LEFT JOIN users u ON u.id=h.actor_user_id
      WHERE h.job_id=? ORDER BY h.created_at DESC,h.id DESC`,[id]);
    const [attachments]=await pool.query(`
      SELECT id,original_name,url,mime_type,size_bytes,category,created_at
      FROM job_attachments WHERE job_id=? ORDER BY created_at DESC,id DESC`,[id]);

    res.json({success:true,job:{...rows[0],items,history,attachments}});
  }catch(error){
    logError("Error obteniendo detalle de trabajo",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el trabajo."});
  }
});

// Técnicos disponibles.
app.get("/api/admin/jobs/assignees",requireAdmin,async(req,res)=>{
  try{
    const [rows]=await pool.query("SELECT id,name,email FROM users ORDER BY name");
    res.json({success:true,users:rows});
  }catch(error){res.status(500).json({error:"No se pudieron obtener los técnicos."});}
});

// Actualizar datos operativos.
app.put("/api/admin/jobs/:id(\\d+)",requireAdmin,adminMutationLimiter,async(req,res)=>{
  try{
    const id=validateJobId(req.params.id);
    if(!id)return res.status(400).json({error:"ID de trabajo inválido."});
    const [rows]=await pool.query("SELECT * FROM jobs WHERE id=? LIMIT 1",[id]);
    if(!rows.length)return res.status(404).json({error:"Trabajo no encontrado."});
    const current=rows[0];
    if(["cerrado","cancelado","rechazado"].includes(current.status))return res.status(409).json({error:"Este trabajo ya está cerrado o cancelado."});

    let assigned=current.assigned_user_id;
    if(req.body.assigned_user_id!==undefined){
      assigned=req.body.assigned_user_id===""||req.body.assigned_user_id===null?null:Number(req.body.assigned_user_id);
      if(assigned!==null&&(!Number.isInteger(assigned)||assigned<=0))return res.status(400).json({error:"Técnico inválido."});
      if(assigned!==null){const [u]=await pool.query("SELECT id FROM users WHERE id=? LIMIT 1",[assigned]);if(!u.length)return res.status(400).json({error:"El técnico no existe."});}
    }
    const scheduled=req.body.scheduled_at===undefined?current.scheduled_at:validateJobDateTime(req.body.scheduled_at);
    if(scheduled===undefined)return res.status(400).json({error:"Fecha programada inválida."});
    const fields={
      assigned_user_id:assigned,
      scheduled_at:scheduled,
      internal_notes:req.body.internal_notes===undefined?current.internal_notes:String(req.body.internal_notes||"").slice(0,10000),
      execution_notes:req.body.execution_notes===undefined?current.execution_notes:String(req.body.execution_notes||"").slice(0,10000),
      location:req.body.location===undefined?current.location:String(req.body.location||"").slice(0,255)
    };
    await pool.query(`UPDATE jobs SET assigned_user_id=?,scheduled_at=?,internal_notes=?,execution_notes=?,location=? WHERE id=?`,
      [fields.assigned_user_id,fields.scheduled_at,fields.internal_notes,fields.execution_notes,fields.location,id]);
    await recordJobHistory(req,id,"job_updated",current.status,current.status,{changes:fields});
    await writeAudit(req,"job_updated","job",id,fields);

    if (String(current.assigned_user_id || "") !== String(fields.assigned_user_id || "")) {
      if (fields.assigned_user_id) {
        await createJobNotification(
          "job_assigned",
          current.quote_id,
          `El trabajo #${id} fue asignado a tu usuario.`,
          id,
          fields.assigned_user_id,
          "high"
        );
      } else {
        await createJobNotification(
          "job_status_changed",
          current.quote_id,
          `El trabajo #${id} quedó sin técnico asignado.`,
          id,
          null,
          "normal"
        );
      }
    }

    if (String(current.scheduled_at || "") !== String(fields.scheduled_at || "") && fields.scheduled_at) {
      await createJobNotification(
        "job_scheduled",
        current.quote_id,
        `El trabajo #${id} fue programado para ${new Date(fields.scheduled_at).toLocaleString("es-AR")}.`,
        id,
        fields.assigned_user_id || null,
        "high"
      );
    }
      await notifyJobCustomer(id, current.status, fields.scheduled_at);
      await notifyJobWhatsApp(id, current.status, fields.scheduled_at);

    res.json({success:true,message:"Trabajo actualizado correctamente."});
  }catch(error){
    logError("Error actualizando trabajo",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el trabajo."});
  }
});

// Cambiar estado con transiciones controladas.
app.put("/api/admin/jobs/:id(\\d+)/status",requireAdmin,adminMutationLimiter,async(req,res)=>{
  const connection=await pool.getConnection();
  try{
    const id=validateJobId(req.params.id);
    const next=validateJobStatus(req.body?.status);
    if(!id||!next){connection.release();return res.status(400).json({error:"ID o estado de trabajo inválido."});}
    const [rows]=await connection.query("SELECT * FROM jobs WHERE id=? LIMIT 1 FOR UPDATE",[id]);
    if(!rows.length){connection.release();return res.status(404).json({error:"Trabajo no encontrado."});}
    const job=rows[0];
    if(job.status===next){connection.release();return res.json({success:true,status:next,message:"El trabajo ya se encuentra en ese estado."});}
    if(!(JOB_TRANSITIONS[job.status]||[]).includes(next)){
      connection.release();return res.status(409).json({error:"No se puede cambiar a ese estado desde el estado actual."});
    }

    const nowFields=[];
    const values=[];
    if(next==="en_proceso"){
      nowFields.push("started_at=COALESCE(started_at,NOW())","started_by_user_id=?");values.push(req.session.user.id);
    }
    if(next==="finalizado"){
      nowFields.push("completed_at=COALESCE(completed_at,NOW())","completed_by_user_id=?");values.push(req.session.user.id);
    }
    if(next==="cerrado" && !job.completed_at){
      nowFields.push("completed_at=NOW()","completed_by_user_id=?");values.push(req.session.user.id);
    }
    nowFields.push("status=?");values.push(next,id);
    await connection.query(`UPDATE jobs SET ${nowFields.join(",")} WHERE id=?`,values);
    await recordJobHistory(req,id,"status_changed",job.status,next,null,connection);
    await connection.commit();

    const messages={
      programado:"Trabajo programado correctamente.",
      en_proceso:"Trabajo iniciado correctamente.",
      pausado:"Trabajo pausado correctamente.",
      finalizado:"Trabajo marcado como finalizado.",
      cerrado:"Trabajo cerrado correctamente.",
      cancelado:"Trabajo cancelado correctamente."
    };
    const notificationType =
      next === "cerrado" ? "job_closed" :
      next === "finalizado" ? "job_finished" :
      next === "en_proceso" ? "job_started" :
      "job_status_changed";
    const notificationPriority =
      ["finalizado","cerrado","en_proceso"].includes(next) ? "high" :
      ["programado","pausado"].includes(next) ? "normal" : "low";
    await createJobNotification(
      notificationType,
      job.quote_id,
      `El trabajo #${id} pasó de ${job.status} a ${next}.`,
      id,
      job.assigned_user_id || null,
      notificationPriority
    );
    await notifyJobCustomer(id, next, next === "programado" ? job.scheduled_at : null);
    await notifyJobWhatsApp(id, next, next === "programado" ? job.scheduled_at : null);
    await writeAudit(req,"job_status_changed","job",id,{old_status:job.status,new_status:next});
    res.json({success:true,status:next,message:messages[next]||"Estado actualizado correctamente."});
  }catch(error){
    await connection.rollback().catch(()=>{});
    logError("Error actualizando estado de trabajo",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el estado del trabajo."});
  }finally{connection.release();}
});

// Historial.
app.get("/api/admin/jobs/:id(\\d+)/history",requireAdmin,async(req,res)=>{
  try{
    const id=validateJobId(req.params.id);if(!id)return res.status(400).json({error:"ID inválido."});
    const [rows]=await pool.query(`
      SELECT h.*,u.name AS actor_name FROM job_history h
      LEFT JOIN users u ON u.id=h.actor_user_id
      WHERE h.job_id=? ORDER BY h.created_at DESC,h.id DESC`,[id]);
    res.json({success:true,history:rows});
  }catch(error){res.status(500).json({error:"No se pudo obtener el historial."});}
});

// Subir evidencia/documento.
app.post("/api/admin/jobs/:id(\\d+)/attachments",requireAdmin,jobUpload.single("file"),async(req,res)=>{
  try{
    const id=validateJobId(req.params.id);if(!id)return res.status(400).json({error:"ID inválido."});
    const [rows]=await pool.query("SELECT id FROM jobs WHERE id=? LIMIT 1",[id]);
    if(!rows.length){if(req.file)fs.unlink(req.file.path,()=>{});return res.status(404).json({error:"Trabajo no encontrado."});}
    if(!req.file)return res.status(400).json({error:"No se recibió ningún archivo."});
    const allowedCategories=["inicio","proceso","final","documento","otro"];
    const category=allowedCategories.includes(String(req.body.category||""))?String(req.body.category):"otro";
    const url="/uploads/"+req.file.filename;
    const [result]=await pool.query(`
      INSERT INTO job_attachments
      (job_id,uploaded_by_user_id,original_name,stored_name,url,mime_type,size_bytes,category)
      VALUES (?,?,?,?,?,?,?,?)`,
      [id,req.session.user.id,req.file.originalname,req.file.filename,url,req.file.mimetype,req.file.size,category]
    );
    await recordJobHistory(req,id,"attachment_added",null,null,{attachment_id:result.insertId,category,name:req.file.originalname});
    await writeAudit(req,"job_attachment_added","job",id,{attachment_id:result.insertId,category});
    res.status(201).json({success:true,id:result.insertId,url,message:"Archivo adjuntado correctamente."});
  }catch(error){
    if(req.file)fs.unlink(req.file.path,()=>{});
    logError("Error subiendo evidencia de trabajo",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo adjuntar el archivo."});
  }
});

// Eliminar evidencia.
app.delete("/api/admin/jobs/:id(\\d+)/attachments/:attachmentId(\\d+)",requireAdmin,adminMutationLimiter,async(req,res)=>{
  try{
    const jobId=validateJobId(req.params.id),attachmentId=validateJobId(req.params.attachmentId);
    if(!jobId||!attachmentId)return res.status(400).json({error:"ID inválido."});
    const [rows]=await pool.query("SELECT * FROM job_attachments WHERE id=? AND job_id=? LIMIT 1",[attachmentId,jobId]);
    if(!rows.length)return res.status(404).json({error:"Archivo no encontrado."});
    const [[publishedGallery]]=await pool.query(
      "SELECT id FROM gallery WHERE source_job_attachment_id=? LIMIT 1",
      [attachmentId]
    );
    if(publishedGallery){
      return res.status(409).json({
        error:"Esta evidencia está publicada en la galería. Eliminá primero la publicación de galería."
      });
    }
    await pool.query("DELETE FROM job_attachments WHERE id=?",[attachmentId]);
    if(rows[0].stored_name)fs.unlink(path.join(uploadsDir,rows[0].stored_name),()=>{});
    await recordJobHistory(req,jobId,"attachment_deleted",null,null,{attachment_id:attachmentId});
    await writeAudit(req,"job_attachment_deleted","job",jobId,{attachment_id:attachmentId});
    res.json({success:true,message:"Archivo eliminado."});
  }catch(error){res.status(500).json({error:"No se pudo eliminar el archivo."});}
});

// Historial cerrado con filtros.
app.get("/api/admin/jobs-history",requireAdmin,async(req,res)=>{
  try{
    const search=String(req.query.search||"").trim();
    const dateFrom=String(req.query.date_from||"").trim();
    const dateTo=String(req.query.date_to||"").trim();
    const params=[];
    let sql=`
      SELECT j.id,j.quote_id,j.status,j.started_at,j.completed_at,j.created_at,j.updated_at,
             j.scheduled_at,j.location,j.assigned_user_id,u.name AS assigned_user_name,
             q.quote_number,q.issue_date,q.subtotal,q.discount,q.total,q.notes,
             qr.name AS client_name,qr.phone AS client_phone,qr.email AS client_email,
             qr.service AS requested_service,qr.description AS work_description
      FROM jobs j
      INNER JOIN quotes q ON q.id=j.quote_id
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN users u ON u.id=j.assigned_user_id
      WHERE j.status IN ('cerrado','finalizado')`;
    if(search){const v=`%${search}%`;sql+=" AND (qr.name LIKE ? OR qr.phone LIKE ? OR qr.email LIKE ? OR q.quote_number LIKE ? OR qr.service LIKE ? OR qr.description LIKE ?)";params.push(v,v,v,v,v,v);}
    if(dateFrom){if(!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom))return res.status(400).json({error:"Fecha desde inválida."});sql+=" AND DATE(COALESCE(j.completed_at,j.created_at))>=?";params.push(dateFrom);}
    if(dateTo){if(!/^\d{4}-\d{2}-\d{2}$/.test(dateTo))return res.status(400).json({error:"Fecha hasta inválida."});sql+=" AND DATE(COALESCE(j.completed_at,j.created_at))<=?";params.push(dateTo);}
    sql+=" ORDER BY COALESCE(j.completed_at,j.created_at) DESC,j.id DESC";
    const [jobs]=await pool.query(sql,params);
    res.json({success:true,jobs,summary:{count:jobs.length,total:jobs.reduce((sum,row)=>sum+Number(row.total||0),0)}});
  }catch(error){logError("Error obteniendo historial de trabajos",{requestId:req.requestId,error:error.message});res.status(500).json({error:"No se pudo obtener el historial."});}
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
// SOLICITUDES - ADMIN V2
// ========================================

const REQUEST_STATUSES = [
  "nueva",
  "en_revision",
  "presupuestando",
  "presupuestada",
  "aceptada",
  "programada",
  "en_trabajo",
  "finalizada",
  "cerrada"
];

const REQUEST_PRIORITIES = [
  "baja",
  "normal",
  "alta",
  "urgente"
];

function validateRequestId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateRequestStatus(status) {
  return REQUEST_STATUSES.includes(String(status || "").trim());
}

function validateRequestPriority(priority) {
  return REQUEST_PRIORITIES.includes(String(priority || "").trim());
}

function validateOptionalDateTime(value) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text) &&
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text)) {
    return undefined;
  }
  return text.replace("T", " ");
}

async function recordRequestHistory(req, requestId, action, oldStatus, newStatus, metadata = null) {
  await pool.query(
    `INSERT INTO quote_request_history
      (quote_request_id, actor_user_id, action, old_status, new_status, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      requestId,
      req.session?.user?.id || null,
      action,
      oldStatus || null,
      newStatus || null,
      metadata ? JSON.stringify(metadata) : null
    ]
  );
}

async function notifyRequestWhatsApp(request, message, entityType="quote_request") {
  try {
    const settings=await whatsappBusinessEnabled();
    if(!settings?.whatsapp_auto_notifications || !request?.whatsapp && !request?.phone) return false;
    const phone=request.whatsapp || request.phone;
    await queueWhatsApp({
      to:phone,
      message,
      requestId:null,
      entityType,
      entityId:request.id
    });
    return true;
  } catch(error) {
    logError("No se pudo encolar WhatsApp de cliente",{requestId:null,error:error.message,entityId:request?.id});
    return false;
  }
}

async function notifyRequestCustomer(request, subject, message) {
  if (!request?.email) return false;
  try {
    const template = String(subject || "").toLowerCase().includes("recibida")
      ? "request_received"
      : "request_status";
    await queueEmail({
      to: request.email,
      subject,
      template,
      data: {
        name: request.name,
        requestId: request.id,
        status: request.status,
        service: request.service,
        message
      },
      requestId: null
    });
    return true;
  } catch (error) {
    logError("No se pudo encolar notificación al cliente", {
      requestId: null,
      error: error.message,
      quoteRequestId: request.id
    });
    return false;
  }
}

async function notifyJobWhatsApp(jobId, status, scheduledAt = null) {
  try {
    const settings=await whatsappBusinessEnabled();
    if(!settings?.whatsapp_auto_notifications) return false;
    const [rows]=await pool.query(
      `SELECT j.id,qr.phone,qr.whatsapp,qr.name
       FROM jobs j
       INNER JOIN quotes q ON q.id=j.quote_id
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE j.id=? LIMIT 1`,[jobId]
    );
    const job=rows[0];
    const phone=job?.whatsapp || job?.phone;
    if(!phone) return false;
    let message=`JR Electricidad: el trabajo #${jobId} está en estado ${String(status).replace(/_/g," ")}.`;
    if(scheduledAt) message+=` Programado para ${new Date(scheduledAt).toLocaleString("es-AR").replace(",", "")}.`;
    await queueWhatsApp({to:phone,message,entityType:"job",entityId:jobId});
    return true;
  } catch(error) {
    logError("No se pudo encolar WhatsApp del trabajo",{requestId:null,error:error.message,jobId});
    return false;
  }
}

async function notifyJobCustomer(jobId, status, scheduledAt = null) {
  try {
    const [rows] = await pool.query(
      `SELECT j.id,j.status,qr.name,qr.email
       FROM jobs j
       INNER JOIN quotes q ON q.id=j.quote_id
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE j.id=? LIMIT 1`,
      [jobId]
    );
    const job=rows[0];
    if(!job?.email) return false;
    await queueEmail({
      to: job.email,
      subject: "Actualización de trabajo #" + jobId + " - JR Electricidad",
      template: "job_update",
      data: {
        name: job.name,
        jobId,
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toLocaleString("es-AR") : null
      }
    });
    return true;
  } catch(error) {
    logError("No se pudo encolar actualización del trabajo al cliente", {
      requestId:null,
      jobId,
      error:error.message
    });
    return false;
  }
}

// Listar solicitudes con búsqueda, estado, prioridad, técnico y fechas.
app.get("/api/admin/quote-requests", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const priority = String(req.query.priority || "").trim();
    const assignedUserId = String(req.query.assigned_user_id || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    if (status && !validateRequestStatus(status)) {
      return res.status(400).json({ error: "Estado de solicitud inválido." });
    }
    if (priority && !validateRequestPriority(priority)) {
      return res.status(400).json({ error: "Prioridad inválida." });
    }

    const params = [];
    let sql = `
      SELECT
        qr.id, qr.client_id, qr.name, qr.phone, qr.email, qr.service,
        qr.description, qr.preferred_date, qr.image_url, qr.status,
        qr.priority, qr.assigned_user_id, qr.scheduled_at,
        qr.internal_notes, qr.closed_at, qr.created_at, qr.updated_at,
        u.name AS assigned_user_name,
        c.locality AS client_locality,
        (SELECT COUNT(*) FROM quote_request_attachments a WHERE a.quote_request_id=qr.id) AS attachments_count,
        (SELECT COUNT(*) FROM quote_request_history h WHERE h.quote_request_id=qr.id) AS history_count,
        q.id AS quote_id,
        q.quote_number,
        j.id AS job_id,
        j.status AS job_status
      FROM quote_requests qr
      LEFT JOIN users u ON u.id=qr.assigned_user_id
      LEFT JOIN clients c ON c.id=qr.client_id
      LEFT JOIN quotes q ON q.quote_request_id=qr.id
      LEFT JOIN jobs j ON j.quote_id=q.id
      WHERE 1=1
    `;

    if (search) {
      const value = `%${search}%`;
      sql += ` AND (
        qr.name LIKE ? OR qr.phone LIKE ? OR qr.email LIKE ? OR
        qr.service LIKE ? OR qr.description LIKE ? OR c.locality LIKE ?
      )`;
      params.push(value, value, value, value, value, value);
    }

    if (status) {
      sql += " AND qr.status=?";
      params.push(status);
    }

    if (priority) {
      sql += " AND qr.priority=?";
      params.push(priority);
    }

    if (assignedUserId) {
      const id = Number(assignedUserId);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Técnico asignado inválido." });
      }
      sql += " AND qr.assigned_user_id=?";
      params.push(id);
    }

    if (dateFrom) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
        return res.status(400).json({ error: "La fecha desde no es válida." });
      }
      sql += " AND DATE(qr.created_at)>=?";
      params.push(dateFrom);
    }

    if (dateTo) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
        return res.status(400).json({ error: "La fecha hasta no es válida." });
      }
      sql += " AND DATE(qr.created_at)<=?";
      params.push(dateTo);
    }

    sql += " ORDER BY FIELD(qr.priority,'urgente','alta','normal','baja'), qr.created_at DESC, qr.id DESC";

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo solicitudes V2", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener las solicitudes." });
  }
});

// Obtener una solicitud completa.
app.get("/api/admin/quote-requests/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID de solicitud inválido." });

    const [rows] = await pool.query(
      `SELECT
        qr.*,
        u.name AS assigned_user_name,
        c.locality AS client_locality,
        c.address AS client_address,
        q.id AS quote_id,
        q.quote_number,
        j.id AS job_id,
        j.status AS job_status
       FROM quote_requests qr
       LEFT JOIN users u ON u.id=qr.assigned_user_id
       LEFT JOIN clients c ON c.id=qr.client_id
       LEFT JOIN quotes q ON q.quote_request_id=qr.id
       LEFT JOIN jobs j ON j.quote_id=q.id
       WHERE qr.id=? LIMIT 1`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: "Solicitud no encontrada." });

    const [history] = await pool.query(
      `SELECT h.*, u.name AS actor_name
       FROM quote_request_history h
       LEFT JOIN users u ON u.id=h.actor_user_id
       WHERE h.quote_request_id=?
       ORDER BY h.created_at DESC, h.id DESC`,
      [id]
    );

    const [attachments] = await pool.query(
      `SELECT id, original_name, url, mime_type, size_bytes, created_at
       FROM quote_request_attachments
       WHERE quote_request_id=?
       ORDER BY created_at DESC, id DESC`,
      [id]
    );

    res.json({
      ...rows[0],
      history,
      attachments
    });
  } catch (error) {
    logError("Error obteniendo detalle de solicitud", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo obtener la solicitud." });
  }
});

// Actualizar estado/prioridad/técnico/agenda/notas.
app.patch("/api/admin/quote-requests/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = validateRequestId(req.params.id);
    if (!id) {
      connection.release();
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    const [existingRows] = await connection.query(
      "SELECT * FROM quote_requests WHERE id=? LIMIT 1 FOR UPDATE",
      [id]
    );

    if (!existingRows.length) {
      connection.release();
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const current = existingRows[0];
    const body = req.body || {};

    let status = body.status === undefined ? current.status : String(body.status || "").trim();
    let priority = body.priority === undefined ? current.priority : String(body.priority || "").trim();

    if (!validateRequestStatus(status)) {
      connection.release();
      return res.status(400).json({ error: "Estado de solicitud inválido." });
    }

    if (!validateRequestPriority(priority)) {
      connection.release();
      return res.status(400).json({ error: "Prioridad inválida." });
    }

    let assignedUserId = current.assigned_user_id;
    if (body.assigned_user_id !== undefined && body.assigned_user_id !== null && String(body.assigned_user_id).trim() !== "") {
      assignedUserId = Number(body.assigned_user_id);
      if (!Number.isInteger(assignedUserId) || assignedUserId <= 0) {
        connection.release();
        return res.status(400).json({ error: "Técnico asignado inválido." });
      }
      const [userRows] = await connection.query("SELECT id FROM users WHERE id=? LIMIT 1", [assignedUserId]);
      if (!userRows.length) {
        connection.release();
        return res.status(400).json({ error: "El técnico asignado no existe." });
      }
    } else if (body.assigned_user_id === null || String(body.assigned_user_id || "").trim() === "") {
      assignedUserId = null;
    }

    const scheduledAt = body.scheduled_at === undefined
      ? current.scheduled_at
      : validateOptionalDateTime(body.scheduled_at);

    if (scheduledAt === undefined) {
      connection.release();
      return res.status(400).json({ error: "La fecha programada no es válida." });
    }

    const internalNotes = body.internal_notes === undefined
      ? String(current.internal_notes || "")
      : String(body.internal_notes || "").trim();

    if (internalNotes.length > 10000) {
      connection.release();
      return res.status(400).json({ error: "Las notas internas no pueden superar 10000 caracteres." });
    }

    const closedAt = status === "cerrada" || status === "finalizada"
      ? (current.closed_at || new Date())
      : null;

    await connection.beginTransaction();

    await connection.query(
      `UPDATE quote_requests
       SET status=?, priority=?, assigned_user_id=?, scheduled_at=?, internal_notes=?, closed_at=?
       WHERE id=?`,
      [status, priority, assignedUserId, scheduledAt, internalNotes || null, closedAt, id]
    );

    if (
      String(current.status) !== status ||
      String(current.priority || "normal") !== priority ||
      Number(current.assigned_user_id || 0) !== Number(assignedUserId || 0) ||
      String(current.scheduled_at || "") !== String(scheduledAt || "") ||
      String(current.internal_notes || "") !== internalNotes
    ) {
      await connection.query(
        `INSERT INTO quote_request_history
          (quote_request_id, actor_user_id, action, old_status, new_status, metadata)
         VALUES (?, ?, 'request_updated', ?, ?, ?)`,
        [
          id,
          req.session.user.id,
          current.status,
          status,
          JSON.stringify({
            priority,
            assigned_user_id: assignedUserId,
            scheduled_at: scheduledAt,
            internal_notes_changed: String(current.internal_notes || "") !== internalNotes
          })
        ]
      );
    }

    await connection.commit();
    connection.release();

    await writeAudit(req, "request_updated", "quote_request", id, {
      status,
      priority,
      assigned_user_id: assignedUserId,
      scheduled_at: scheduledAt
    });

    if (String(current.status) !== status) {
      await createAdminNotification({
        type: "quote_request_status",
        message: `La solicitud #${id} cambió de "${current.status}" a "${status}".`,
        entityType: "quote_request",
        entityId: id,
        linkUrl: "/admin.html#quoteRequestsSection",
        priority: ["urgente","alta"].includes(String(priority)) ? "high" : "normal"
      }).catch(() => {});

      const [requestRows] = await pool.query(
        "SELECT id,name,email,phone,whatsapp,service,status FROM quote_requests WHERE id=? LIMIT 1",
        [id]
      );
      if (requestRows.length) {
        await notifyRequestCustomer(
          requestRows[0],
          `Actualización de tu solicitud #${id} - JR Electricidad`,
          `El estado de tu solicitud cambió a: ${status.replace(/_/g, " ")}.`
        );
        await notifyRequestWhatsApp(
          requestRows[0],
          `JR Electricidad: tu solicitud #${id} cambió a ${status.replace(/_/g, " ")}.`
        );
      }
    }

    res.json({ success: true, message: "Solicitud actualizada correctamente." });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error actualizando solicitud V2", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo actualizar la solicitud." });
  }
});

// Compatibilidad V1 para cambio de estado.
app.patch("/api/admin/quote-requests/:id(\\d+)/status", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    const statusMap = {
      pendiente: "nueva",
      contactado: "en_revision",
      presupuestado: "presupuestada",
      cerrado: "cerrada"
    };
    const incoming = String(req.body.status || "").trim();
    const status = statusMap[incoming] || incoming;

    if (!id || !validateRequestStatus(status)) {
      return res.status(400).json({ error: "Estado de solicitud inválido." });
    }

    const [currentRows] = await pool.query("SELECT status FROM quote_requests WHERE id=? LIMIT 1", [id]);
    if (!currentRows.length) return res.status(404).json({ error: "Solicitud no encontrada." });

    await pool.query("UPDATE quote_requests SET status=?, closed_at=? WHERE id=?",
      [status, status === "cerrada" ? new Date() : null, id]);

    await pool.query(
      `INSERT INTO quote_request_history
        (quote_request_id, actor_user_id, action, old_status, new_status)
       VALUES (?, ?, 'status_changed', ?, ?)`,
      [id, req.session.user.id, currentRows[0].status, status]
    );

    await writeAudit(req, "request_status_changed", "quote_request", id, {
      old_status: currentRows[0].status,
      new_status: status
    });

    await createAdminNotification({
      type: "quote_request_status",
      message: `La solicitud #${id} cambió al estado "${status}".`,
      entityType: "quote_request",
      entityId: id,
      linkUrl: "/admin.html#quoteRequestsSection",
      priority: "normal"
    }).catch(() => {});

    res.json({ success: true, message: "Estado de la solicitud actualizado.", status });
  } catch (error) {
    logError("Error actualizando estado de solicitud", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo actualizar el estado." });
  }
});

// Historial independiente.
app.get("/api/admin/quote-requests/:id(\\d+)/history", requireAdmin, async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID de solicitud inválido." });

    const [rows] = await pool.query(
      `SELECT h.id,h.action,h.old_status,h.new_status,h.metadata,h.created_at,u.name AS actor_name
       FROM quote_request_history h
       LEFT JOIN users u ON u.id=h.actor_user_id
       WHERE h.quote_request_id=?
       ORDER BY h.created_at DESC,h.id DESC`,
      [id]
    );
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo historial de solicitud", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo obtener el historial." });
  }
});

// Técnicos disponibles.
app.get("/api/admin/quote-requests/assignees", requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id,name,email,role FROM users ORDER BY name ASC"
    );
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo técnicos", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener los técnicos." });
  }
});

// Adjuntar imágenes/documentos.
const requestAttachmentsDir = path.join(uploadsDir, "requests");
if (!fs.existsSync(requestAttachmentsDir)) fs.mkdirSync(requestAttachmentsDir, { recursive: true });

const requestAttachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, requestAttachmentsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, Date.now() + "-" + crypto.randomBytes(10).toString("hex") + ext);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain"
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Tipo de archivo no permitido."));
    }
    cb(null, true);
  }
});

app.post("/api/admin/quote-requests/:id(\\d+)/attachments", requireAdmin, requestAttachmentUpload.single("file"), async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    if (!id) {
      if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    if (!req.file) return res.status(400).json({ error: "Seleccioná un archivo." });

    const [rows] = await pool.query("SELECT id FROM quote_requests WHERE id=? LIMIT 1", [id]);
    if (!rows.length) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const url = "/uploads/requests/" + req.file.filename;

    const [result] = await pool.query(
      `INSERT INTO quote_request_attachments
        (quote_request_id, uploaded_by_user_id, original_name, stored_name, url, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.session.user.id,
        String(req.file.originalname || "").slice(0, 255),
        req.file.filename,
        url,
        req.file.mimetype,
        Number(req.file.size || 0)
      ]
    );

    await recordRequestHistory(req, id, "attachment_added", null, null, {
      attachment_id: result.insertId,
      original_name: req.file.originalname
    });

    await writeAudit(req, "request_attachment_added", "quote_request", id, {
      attachment_id: result.insertId,
      original_name: req.file.originalname
    });

    res.status(201).json({
      success: true,
      attachment: {
        id: result.insertId,
        original_name: req.file.originalname,
        url,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size
      }
    });
  } catch (error) {
    if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
    logError("Error adjuntando archivo a solicitud", { requestId: req.requestId, error: error.message });
    res.status(400).json({ error: error.message || "No se pudo adjuntar el archivo." });
  }
});

app.delete("/api/admin/quote-requests/:id(\\d+)/attachments/:attachmentId(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    const attachmentId = validateRequestId(req.params.attachmentId);
    if (!id || !attachmentId) return res.status(400).json({ error: "ID de solicitud o archivo inválido." });

    const [rows] = await pool.query(
      "SELECT * FROM quote_request_attachments WHERE id=? AND quote_request_id=? LIMIT 1",
      [attachmentId, id]
    );
    if (!rows.length) return res.status(404).json({ error: "Archivo no encontrado." });

    const filePath = path.join(requestAttachmentsDir, rows[0].stored_name);
    await fs.promises.unlink(filePath).catch(() => {});
    await pool.query("DELETE FROM quote_request_attachments WHERE id=?", [attachmentId]);

    await recordRequestHistory(req, id, "attachment_deleted", null, null, {
      attachment_id: attachmentId,
      original_name: rows[0].original_name
    });

    await writeAudit(req, "request_attachment_deleted", "quote_request", id, {
      attachment_id: attachmentId
    });

    res.json({ success: true, message: "Archivo eliminado." });
  } catch (error) {
    logError("Error eliminando archivo de solicitud", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo eliminar el archivo." });
  }
});

// Convertir solicitud a presupuesto borrador.
app.post("/api/admin/quote-requests/:id(\\d+)/convert-to-quote", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = validateRequestId(req.params.id);
    if (!id) {
      connection.release();
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    await connection.beginTransaction();

    const [requestRows] = await connection.query(
      "SELECT * FROM quote_requests WHERE id=? LIMIT 1 FOR UPDATE",
      [id]
    );
    if (!requestRows.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const request = requestRows[0];

    const [existingQuotes] = await connection.query(
      "SELECT id,quote_number,status FROM quotes WHERE quote_request_id=? ORDER BY id DESC LIMIT 1",
      [id]
    );

    if (existingQuotes.length) {
      await connection.commit();
      connection.release();
      return res.json({
        success: true,
        already_exists: true,
        quote_id: existingQuotes[0].id,
        quote_number: existingQuotes[0].quote_number,
        status: existingQuotes[0].status
      });
    }

    const quoteNumber = `PR-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${id}`;
    const accessToken = crypto.randomBytes(24).toString("hex");

    const [quoteResult] = await connection.query(
      `INSERT INTO quotes
        (quote_request_id, quote_number, access_token, issue_date, expiration_date, notes, status, subtotal, discount, total)
       VALUES (?, ?, ?, CURDATE(), NULL, ?, 'borrador', 0, 0, 0)`,
      [id, quoteNumber, accessToken, request.internal_notes || request.description || ""]
    );

    await connection.query(
      `INSERT INTO quote_items
        (quote_id, description, quantity, unit, unit_price, total)
       VALUES (?, ?, 1, 'global', 0, 0)`,
      [quoteResult.insertId, request.service || request.description || "Trabajo solicitado"]
    );

    const newStatus = request.status === "nueva" || request.status === "en_revision" || request.status === "presupuestando"
      ? "presupuestada"
      : request.status;

    await connection.query(
      "UPDATE quote_requests SET status=? WHERE id=?",
      [newStatus, id]
    );

    await connection.query(
      `INSERT INTO quote_request_history
        (quote_request_id, actor_user_id, action, old_status, new_status, metadata)
       VALUES (?, ?, 'converted_to_quote', ?, ?, ?)`,
      [id, req.session.user.id, request.status, newStatus, JSON.stringify({ quote_id: quoteResult.insertId })]
    );

    await connection.commit();
    connection.release();

    await writeAudit(req, "request_converted_to_quote", "quote_request", id, {
      quote_id: quoteResult.insertId
    });

    res.status(201).json({
      success: true,
      quote_id: quoteResult.insertId,
      quote_number: quoteNumber,
      status: "borrador"
    });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error convirtiendo solicitud a presupuesto", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo convertir la solicitud en presupuesto." });
  }
});

// Convertir solicitud a trabajo. Si no existe presupuesto, crea uno borrador primero.
app.post("/api/admin/quote-requests/:id(\\d+)/convert-to-job", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = validateRequestId(req.params.id);
    if (!id) {
      connection.release();
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    await connection.beginTransaction();

    const [requestRows] = await connection.query(
      "SELECT * FROM quote_requests WHERE id=? LIMIT 1 FOR UPDATE",
      [id]
    );
    if (!requestRows.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const request = requestRows[0];

    const [quoteRows] = await connection.query(
      "SELECT id,quote_number FROM quotes WHERE quote_request_id=? ORDER BY id DESC LIMIT 1",
      [id]
    );

    let quoteId;
    let quoteNumber;

    if (quoteRows.length) {
      quoteId = quoteRows[0].id;
      quoteNumber = quoteRows[0].quote_number;
    } else {
      quoteNumber = `PR-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${id}`;
      const accessToken = crypto.randomBytes(24).toString("hex");

      const [quoteResult] = await connection.query(
        `INSERT INTO quotes
          (quote_request_id, quote_number, access_token, issue_date, expiration_date, notes, status, subtotal, discount, total)
         VALUES (?, ?, ?, CURDATE(), NULL, ?, 'borrador', 0, 0, 0)`,
        [id, quoteNumber, accessToken, request.internal_notes || request.description || ""]
      );

      quoteId = quoteResult.insertId;

      await connection.query(
        `INSERT INTO quote_items
          (quote_id, description, quantity, unit, unit_price, total)
         VALUES (?, ?, 1, 'global', 0, 0)`,
        [quoteId, request.service || request.description || "Trabajo solicitado"]
      );
    }

    const [jobRows] = await connection.query(
      "SELECT id,status FROM jobs WHERE quote_id=? LIMIT 1",
      [quoteId]
    );

    if (jobRows.length) {
      await connection.commit();
      connection.release();
      return res.json({
        success: true,
        already_exists: true,
        job_id: jobRows[0].id,
        quote_id: quoteId,
        quote_number: quoteNumber,
        status: jobRows[0].status
      });
    }

    const [jobResult] = await connection.query(
      "INSERT INTO jobs (quote_id,status) VALUES (?, 'pendiente_presupuesto')",
      [quoteId]
    );

    await connection.query(
      `INSERT INTO quote_request_history
        (quote_request_id, actor_user_id, action, old_status, new_status, metadata)
       VALUES (?, ?, 'converted_to_job', ?, 'programada', ?)`,
      [id, req.session.user.id, request.status, JSON.stringify({ quote_id: quoteId, job_id: jobResult.insertId })]
    );

    await connection.query(
      "UPDATE quote_requests SET status='programada' WHERE id=?",
      [id]
    );

    await connection.commit();
    connection.release();

    await writeAudit(req, "request_converted_to_job", "quote_request", id, {
      quote_id: quoteId,
      job_id: jobResult.insertId
    });

    res.status(201).json({
      success: true,
      job_id: jobResult.insertId,
      quote_id: quoteId,
      quote_number: quoteNumber,
      status: "programada"
    });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error convirtiendo solicitud a trabajo", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo convertir la solicitud en trabajo." });
  }
});

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
    const token = String(req.params.token || "").trim();
    if (!/^[A-Za-z0-9_-]{24,200}$/.test(token)) {
      return res.status(404).json({ error: "Presupuesto no encontrado o enlace inválido." });
    }

    const [rows] = await pool.query(
      `SELECT
        q.id, q.quote_number, q.issue_date, q.expiration_date, q.notes,
        q.status, q.subtotal, q.discount, q.total, q.viewed_at,
        qr.name AS client_name, qr.email AS client_email, qr.phone AS client_phone,
        qr.service AS requested_service,
        qi.id AS item_id, qi.description, qi.quantity, qi.unit, qi.unit_price,
        qi.total AS item_total,
        qa.id AS acceptance_id, qa.decision AS acceptance_decision,
        qa.customer_name AS acceptance_customer_name,
        qa.customer_email AS acceptance_customer_email,
        qa.customer_phone AS acceptance_customer_phone,
        qa.customer_note AS acceptance_note,
        qa.consent_text AS acceptance_consent_text,
        qa.signature_name AS acceptance_signature_name,
        qa.ip_address AS acceptance_ip,
        qa.user_agent AS acceptance_user_agent,
        qa.created_at AS acceptance_created_at
      FROM quotes q
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN quote_items qi ON qi.quote_id=q.id
      LEFT JOIN (
        SELECT qa1.*
        FROM quote_acceptances qa1
        INNER JOIN (
          SELECT quote_id, MAX(id) AS max_id
          FROM quote_acceptances
          GROUP BY quote_id
        ) latest ON latest.max_id=qa1.id
      ) qa ON qa.quote_id=q.id
      WHERE q.access_token=?
      ORDER BY qi.id ASC`,
      [token]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Presupuesto no encontrado o enlace inválido." });
    }

    await pool.query(
      "UPDATE quotes SET viewed_at=COALESCE(viewed_at,NOW()) WHERE id=?",
      [rows[0].id]
    ).catch(() => {});

    const row = rows[0];
    const quote = {
      id: row.id,
      quote_number: row.quote_number,
      issue_date: row.issue_date,
      expiration_date: row.expiration_date,
      notes: row.notes,
      status: row.status,
      viewed_at: row.viewed_at,
      subtotal: row.subtotal,
      discount: row.discount,
      total: row.total,
      client_name: row.client_name,
      client_email: row.client_email,
      client_phone: row.client_phone,
      requested_service: row.requested_service,
      items: [],
      acceptance: row.acceptance_id ? {
        id: row.acceptance_id,
        decision: row.acceptance_decision,
        customer_name: row.acceptance_customer_name,
        customer_email: row.acceptance_customer_email,
        customer_phone: row.acceptance_customer_phone,
        note: row.acceptance_note,
        consent_text: row.acceptance_consent_text,
        signature_name: row.acceptance_signature_name,
        ip_address: row.acceptance_ip,
        user_agent: row.acceptance_user_agent,
        created_at: row.acceptance_created_at
      } : null
    };

    for (const item of rows) {
      if (item.item_id) {
        quote.items.push({
          id: item.item_id,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price,
          total: item.item_total
        });
      }
    }

    res.json(quote);
  } catch (error) {
    logError("Error obteniendo presupuesto público", { requestId:req.requestId, error:error.message });
    res.status(500).json({ error:"No se pudo obtener el presupuesto." });
  }
});
// ========================================
// PRESUPUESTOS - ADMIN
// ========================================

// =========================================================
// PRESUPUESTOS V2 — ADMIN
// =========================================================

const QUOTE_STATUSES = [
  "borrador",
  "enviado",
  "aceptado",
  "rechazado",
  "vencido",
  "cerrado"
];

function validateQuoteId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateQuoteStatus(value) {
  return QUOTE_STATUSES.includes(String(value || "").trim());
}

function validateQuoteDate(value) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  return text;
}

async function recordQuoteHistory(req, quoteId, action, oldStatus, newStatus, metadata = null, db = pool) {
  await db.query(
    `INSERT INTO quote_history
      (quote_id, actor_user_id, action, old_status, new_status, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      quoteId,
      req.session?.user?.id || null,
      action,
      oldStatus || null,
      newStatus || null,
      metadata ? JSON.stringify(metadata) : null
    ]
  );
}

async function notifyQuoteWhatsApp(quote) {
  try {
    const settings=await whatsappBusinessEnabled();
    if(!settings?.whatsapp_auto_notifications || !quote?.phone) return false;
    await queueWhatsApp({
      to:quote.phone,
      message:`JR Electricidad: tu presupuesto ${quote.quote_number} ya está disponible. Podés consultarlo en: ${(process.env.APP_URL || "")}/presupuesto/${encodeURIComponent(quote.access_token)}`,
      entityType:"quote",
      entityId:quote.id
    });
    return true;
  } catch(error) {
    logError("No se pudo encolar WhatsApp del presupuesto",{requestId:null,error:error.message,quoteId:quote?.id});
    return false;
  }
}

async function sendQuoteEmail(quote) {
  if (!quote?.email) return false;
  try {
    await queueEmail({
      to: quote.email,
      subject: "Presupuesto " + quote.quote_number + " - JR Electricidad",
      template: "quote_sent",
      data: {
        name: quote.name || quote.client_name || "",
        quoteNumber: quote.quote_number,
        total: quoteMoney(quote.total),
        link: (process.env.APP_URL || "") + "/presupuesto/" + encodeURIComponent(quote.access_token)
      }
    });
    return true;
  } catch (error) {
    logError("No se pudo encolar el presupuesto por email", {
      requestId: null,
      quoteId: quote.id,
      error: error.message
    });
    return false;
  }
}

// PDF del presupuesto.
app.get("/api/admin/quotes/:id(\\d+)/pdf", requireAdmin, async (req, res) => {
  try {
    const id = validateQuoteId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID de presupuesto inválido." });

    const quote = await getQuoteDetail(pool, id);
    if (!quote) return res.status(404).json({ error: "Presupuesto no encontrado." });

    const doc = buildQuotePdf(quote);
    const pdf = await pdfToBuffer(doc);
    const filename = quote.pdf_filename || `presupuesto-${quote.quote_number || id}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${String(filename).replace(/[^a-zA-Z0-9._-]/g, "_")}"`
    );
    res.setHeader("Content-Length", pdf.length);
    res.send(pdf);
  } catch (error) {
    logError("Error generando PDF del presupuesto", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo generar el PDF del presupuesto." });
  }
});

// Listado con búsqueda y filtros.
app.get("/api/admin/quotes", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    if (status && !validateQuoteStatus(status)) {
      return res.status(400).json({ error: "Estado de presupuesto inválido." });
    }

    const params = [];
    let sql = `
      SELECT
        q.id,q.quote_number,q.access_token,q.issue_date,q.expiration_date,
        q.subtotal,q.discount,q.total,q.status,q.sent_at,q.accepted_at,
        q.rejected_at,q.created_at,q.updated_at,
        qr.id AS quote_request_id,qr.name AS client_name,qr.email AS client_email,
        qr.phone AS client_phone,qr.service AS requested_service,
        COUNT(qi.id) AS items_count,
        j.id AS job_id,j.status AS job_status
      FROM quotes q
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN quote_items qi ON qi.quote_id=q.id
      LEFT JOIN jobs j ON j.quote_id=q.id
      WHERE 1=1
    `;

    if (search) {
      const v = `%${search}%`;
      sql += " AND (q.quote_number LIKE ? OR qr.name LIKE ? OR qr.email LIKE ? OR qr.phone LIKE ? OR qr.service LIKE ?)";
      params.push(v,v,v,v,v);
    }
    if (status) {
      sql += " AND q.status=?";
      params.push(status);
    }
    if (dateFrom) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) return res.status(400).json({ error: "Fecha desde inválida." });
      sql += " AND DATE(q.created_at)>=?";
      params.push(dateFrom);
    }
    if (dateTo) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) return res.status(400).json({ error: "Fecha hasta inválida." });
      sql += " AND DATE(q.created_at)<=?";
      params.push(dateTo);
    }

    sql += `
      GROUP BY q.id,q.quote_number,q.access_token,q.issue_date,q.expiration_date,
        q.subtotal,q.discount,q.total,q.status,q.sent_at,q.accepted_at,q.rejected_at,
        q.created_at,q.updated_at,qr.id,qr.name,qr.email,qr.phone,qr.service,j.id,j.status
      ORDER BY q.created_at DESC,q.id DESC
    `;

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo presupuestos", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener los presupuestos." });
  }
});

// Detalle completo.
app.get("/api/admin/quotes/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = validateQuoteId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID de presupuesto inválido." });

    const quote = await getQuoteDetail(pool, id);
    if (!quote) return res.status(404).json({ error: "Presupuesto no encontrado." });

    const [history] = await pool.query(
      `SELECT h.*,u.name AS actor_name
       FROM quote_history h
       LEFT JOIN users u ON u.id=h.actor_user_id
       WHERE h.quote_id=?
       ORDER BY h.created_at DESC,h.id DESC`,
      [id]
    );

    const [jobs] = await pool.query(
      "SELECT id,status,started_at,completed_at,created_at,updated_at FROM jobs WHERE quote_id=? ORDER BY id DESC",
      [id]
    );

    res.json({ ...quote, history, jobs });
  } catch (error) {
    logError("Error obteniendo detalle de presupuesto", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo obtener el presupuesto." });
  }
});

// Crear presupuesto.
app.post("/api/admin/quotes", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const body = req.body || {};
    const requestId = validateRequestId(body.quote_request_id);
    if (!requestId) {
      connection.release();
      return res.status(400).json({ error: "La solicitud asociada es obligatoria." });
    }

    const issueDate = validateQuoteDate(body.issue_date);
    const expirationDate = validateQuoteDate(body.expiration_date);
    if (issueDate === undefined || expirationDate === undefined) {
      connection.release();
      return res.status(400).json({ error: "Las fechas del presupuesto no son válidas." });
    }

    const discount = Number(body.discount || 0);
    if (!Number.isFinite(discount) || discount < 0 || discount > 1000000000) {
      connection.release();
      return res.status(400).json({ error: "El descuento no es válido." });
    }

    const items = cleanQuoteItems(body.items);
    const subtotal = items.reduce((sum,item) => sum + item.total, 0);
    if (discount > subtotal) {
      connection.release();
      return res.status(400).json({ error: "El descuento no puede superar el subtotal." });
    }
    const total = subtotal - discount;
    const notes = String(body.notes || "").trim();
    if (notes.length > 5000) {
      connection.release();
      return res.status(400).json({ error: "Las notas no pueden superar 5000 caracteres." });
    }

    await connection.beginTransaction();

    const [requestRows] = await connection.query(
      "SELECT * FROM quote_requests WHERE id=? LIMIT 1 FOR UPDATE",
      [requestId]
    );
    if (!requestRows.length) {
      await connection.rollback(); connection.release();
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const quoteNumber = `PR-${new Date().toISOString().replace(/\D/g,"").slice(0,14)}-${requestId}`;
    const accessToken = crypto.randomBytes(32).toString("hex");

    const [result] = await connection.query(
      `INSERT INTO quotes
       (quote_request_id,quote_number,access_token,issue_date,expiration_date,notes,status,subtotal,discount,total)
       VALUES (?,?,?,?,?,?,'borrador',?,?,?)`,
      [requestId,quoteNumber,accessToken,issueDate || new Date().toISOString().slice(0,10),expirationDate,notes,subtotal,discount,total]
    );

    for (const item of items) {
      await connection.query(
        `INSERT INTO quote_items (quote_id,description,quantity,unit,unit_price,total)
         VALUES (?,?,?,?,?,?)`,
        [result.insertId,item.description,item.quantity,item.unit,item.unit_price,item.total]
      );
    }

    await connection.query(
      `INSERT INTO quote_history (quote_id,actor_user_id,action,new_status,metadata)
       VALUES (?,?,'quote_created','borrador',?)`,
      [result.insertId,req.session.user.id,JSON.stringify({ quote_request_id: requestId, items: items.length })]
    );

    await connection.commit();
    connection.release();

    await writeAudit(req,"quote_created","quote",result.insertId,{quote_request_id:requestId,total});

    res.status(201).json({
      success:true,
      id:result.insertId,
      quote_id:result.insertId,
      quote_number:quoteNumber,
      total
    });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error creando presupuesto", { requestId:req.requestId, error:error.message });
    res.status(500).json({ error:"No se pudo crear el presupuesto." });
  }
});

// Actualizar presupuesto.
app.put("/api/admin/quotes/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = validateQuoteId(req.params.id);
    if (!id) { connection.release(); return res.status(400).json({error:"ID de presupuesto inválido."}); }

    const body = req.body || {};
    const issueDate = validateQuoteDate(body.issue_date);
    const expirationDate = validateQuoteDate(body.expiration_date);
    if (issueDate === undefined || expirationDate === undefined) {
      connection.release(); return res.status(400).json({error:"Las fechas del presupuesto no son válidas."});
    }

    const discount = Number(body.discount || 0);
    if (!Number.isFinite(discount) || discount < 0 || discount > 1000000000) {
      connection.release(); return res.status(400).json({error:"El descuento no es válido."});
    }

    const items = cleanQuoteItems(body.items);
    const subtotal = items.reduce((sum,item)=>sum+item.total,0);
    if (discount > subtotal) {
      connection.release(); return res.status(400).json({error:"El descuento no puede superar el subtotal."});
    }
    const total = subtotal-discount;
    const notes = String(body.notes || "").trim();
    if (notes.length > 5000) {
      connection.release(); return res.status(400).json({error:"Las notas no pueden superar 5000 caracteres."});
    }

    await connection.beginTransaction();

    const [rows] = await connection.query("SELECT * FROM quotes WHERE id=? LIMIT 1 FOR UPDATE",[id]);
    if (!rows.length) {
      await connection.rollback(); connection.release();
      return res.status(404).json({error:"Presupuesto no encontrado."});
    }

    const current = rows[0];
    if (["aceptado","cerrado"].includes(current.status)) {
      await connection.rollback(); connection.release();
      return res.status(409).json({error:"No se puede modificar un presupuesto aceptado o cerrado."});
    }

    await connection.query(
      `UPDATE quotes
       SET issue_date=?,expiration_date=?,notes=?,subtotal=?,discount=?,total=?
       WHERE id=?`,
      [issueDate || current.issue_date,expirationDate,notes,subtotal,discount,total,id]
    );

    await connection.query("DELETE FROM quote_items WHERE quote_id=?",[id]);
    for (const item of items) {
      await connection.query(
        `INSERT INTO quote_items (quote_id,description,quantity,unit,unit_price,total)
         VALUES (?,?,?,?,?,?)`,
        [id,item.description,item.quantity,item.unit,item.unit_price,item.total]
      );
    }

    await connection.query(
      `INSERT INTO quote_history (quote_id,actor_user_id,action,old_status,new_status,metadata)
       VALUES (?,?,'quote_updated',?,?,?)`,
      [id,req.session.user.id,current.status,current.status,JSON.stringify({subtotal,discount,total,items:items.length})]
    );

    await connection.commit();
    connection.release();

    await writeAudit(req,"quote_updated","quote",id,{subtotal,discount,total});

    res.json({success:true,message:"Presupuesto actualizado correctamente.",total});
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error actualizando presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el presupuesto."});
  }
});

// Cambiar estado y enviar al cliente.
app.patch("/api/admin/quotes/:id(\\d+)/status", requireAdmin, adminMutationLimiter, async (req,res)=>{
  const id=validateQuoteId(req.params.id);
  const status=String(req.body?.status||"").trim();

  if(!id || !validateQuoteStatus(status)) {
    return res.status(400).json({error:"Estado de presupuesto inválido."});
  }

  try {
    const [rows]=await pool.query(
      `SELECT q.*,qr.name,qr.email
       FROM quotes q INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE q.id=? LIMIT 1`,[id]
    );
    if(!rows.length) return res.status(404).json({error:"Presupuesto no encontrado."});
    const current=rows[0];

    if(["aceptado","cerrado"].includes(current.status) && current.status!==status) {
      return res.status(409).json({error:"El presupuesto ya está cerrado para cambios."});
    }

    const allowedTransitions={
      borrador:["borrador","enviado","cerrado"],
      enviado:["enviado","aceptado","rechazado","vencido","cerrado"],
      aceptado:["aceptado","cerrado"],
      rechazado:["rechazado","borrador","cerrado"],
      vencido:["vencido","borrador","cerrado"],
      cerrado:["cerrado"]
    };

    if(!allowedTransitions[current.status]?.includes(status)) {
      return res.status(409).json({error:`No se puede pasar de "${current.status}" a "${status}".`});
    }

    const sentAt=status==="enviado" ? new Date() : current.sent_at;
    const acceptedAt=status==="aceptado" ? new Date() : current.accepted_at;
    const rejectedAt=status==="rechazado" ? new Date() : current.rejected_at;

    await pool.query(
      `UPDATE quotes SET status=?,sent_at=?,accepted_at=?,rejected_at=? WHERE id=?`,
      [status,sentAt,acceptedAt,rejectedAt,id]
    );

    await recordQuoteHistory(req,id,"quote_status_changed",current.status,status,{});

    await writeAudit(req,"quote_status_changed","quote",id,{old_status:current.status,new_status:status});

    if(status==="enviado") {
      const sent=await sendQuoteEmail({...current,status,total:current.total});
      await notifyQuoteWhatsApp({...current,status,total:current.total});
      await createAdminNotification({
        type: "quote_sent",
        quoteId: id,
        entityType: "quote",
        entityId: id,
        message: `El presupuesto ${current.quote_number} fue marcado como enviado.`,
        linkUrl: "/admin.html#quotesSection",
        priority: "normal"
      }).catch(() => {});
      res.json({success:true,status,email_sent:sent,message:sent?"Presupuesto enviado al cliente.":"Presupuesto marcado como enviado; email no disponible o no configurado."});
      return;
    }

    if(status==="aceptado") {
      await pool.query(
        "UPDATE quote_requests SET status='aceptada' WHERE id=? AND status NOT IN ('cerrada','finalizada')",
        [current.quote_request_id]
      );
    }

    res.json({success:true,status});
  } catch(error) {
    logError("Error cambiando estado del presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo cambiar el estado del presupuesto."});
  }
});

// Eliminar solamente borradores.
app.delete("/api/admin/quotes/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req,res)=>{
  try {
    const id=validateQuoteId(req.params.id);
    if(!id) return res.status(400).json({error:"ID de presupuesto inválido."});

    const [rows]=await pool.query("SELECT status,quote_number FROM quotes WHERE id=? LIMIT 1",[id]);
    if(!rows.length) return res.status(404).json({error:"Presupuesto no encontrado."});
    if(rows[0].status!=="borrador") return res.status(409).json({error:"Solo se pueden eliminar presupuestos en borrador."});

    await pool.query("DELETE FROM quotes WHERE id=?",[id]);
    await writeAudit(req,"quote_deleted","quote",id,{quote_number:rows[0].quote_number});
    res.json({success:true,message:"Presupuesto eliminado."});
  } catch(error) {
    logError("Error eliminando presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo eliminar el presupuesto."});
  }
});

// Historial del presupuesto.
app.get("/api/admin/quotes/:id(\\d+)/history", requireAdmin, async (req,res)=>{
  try {
    const id=validateQuoteId(req.params.id);
    if(!id) return res.status(400).json({error:"ID de presupuesto inválido."});
    const [rows]=await pool.query(
      `SELECT h.*,u.name AS actor_name
       FROM quote_history h LEFT JOIN users u ON u.id=h.actor_user_id
       WHERE h.quote_id=? ORDER BY h.created_at DESC,h.id DESC`,[id]
    );
    res.json(rows);
  } catch(error) {
    logError("Error obteniendo historial de presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el historial del presupuesto."});
  }
});

// =====================================================
// NOTIFICACIONES DEL ADMINISTRADOR — V2
// =====================================================

app.get("/api/admin/notifications", requireAdmin, async (req,res) => {
  try {
    const limitRaw = Number(req.query.limit || 50);
    const limit = Math.min(Math.max(Number.isInteger(limitRaw) ? limitRaw : 50, 1), 100);
    const includeArchived = String(req.query.archived || "") === "1";
    const recipient = Number(req.session.user.id);

    const [rows] = await pool.query(
      `SELECT id,user_id,type,quote_id,entity_type,entity_id,message,link_url,priority,
              is_read,read_at,archived_at,created_at
       FROM admin_notifications
       WHERE (user_id IS NULL OR user_id=?)
         AND (?=1 OR archived_at IS NULL)
       ORDER BY is_read ASC, created_at DESC, id DESC
       LIMIT ${limit}`,
      [recipient, includeArchived ? 1 : 0]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS unread
       FROM admin_notifications
       WHERE (user_id IS NULL OR user_id=?)
         AND is_read=0
         AND archived_at IS NULL`,
      [recipient]
    );

    res.json({
      success:true,
      notifications:rows,
      unread:Number(countRows[0]?.unread || 0)
    });
  } catch(error) {
    logError("Error obteniendo notificaciones",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron obtener las notificaciones."});
  }
});

app.post("/api/admin/notifications/:id/read", requireAdmin, async (req,res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de notificación inválido."});
    const [result]=await pool.query(
      `UPDATE admin_notifications
       SET is_read=1,read_at=COALESCE(read_at,NOW())
       WHERE id=? AND (user_id IS NULL OR user_id=?) AND archived_at IS NULL`,
      [id,Number(req.session.user.id)]
    );
    if(!result.affectedRows) return res.status(404).json({error:"Notificación no encontrada."});
    res.json({success:true,message:"Notificación marcada como leída."});
  } catch(error) {
    logError("Error marcando notificación",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar la notificación."});
  }
});

app.post("/api/admin/notifications/read-all", requireAdmin, async (req,res) => {
  try {
    await pool.query(
      `UPDATE admin_notifications
       SET is_read=1,read_at=COALESCE(read_at,NOW())
       WHERE (user_id IS NULL OR user_id=?)
         AND is_read=0 AND archived_at IS NULL`,
      [Number(req.session.user.id)]
    );
    res.json({success:true,message:"Todas las notificaciones fueron marcadas como leídas."});
  } catch(error) {
    logError("Error marcando notificaciones",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron marcar las notificaciones como leídas."});
  }
});

app.post("/api/admin/notifications/:id/archive", requireAdmin, async (req,res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de notificación inválido."});
    const [result]=await pool.query(
      `UPDATE admin_notifications
       SET archived_at=NOW(),is_read=1,read_at=COALESCE(read_at,NOW())
       WHERE id=? AND (user_id IS NULL OR user_id=?) AND archived_at IS NULL`,
      [id,Number(req.session.user.id)]
    );
    if(!result.affectedRows) return res.status(404).json({error:"Notificación no encontrada."});
    res.json({success:true,message:"Notificación archivada."});
  } catch(error) {
    logError("Error archivando notificación",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo archivar la notificación."});
  }
});

app.post("/api/admin/notifications/archive-all", requireAdmin, async (req,res) => {
  try {
    await pool.query(
      `UPDATE admin_notifications
       SET archived_at=NOW(),is_read=1,read_at=COALESCE(read_at,NOW())
       WHERE (user_id IS NULL OR user_id=?) AND archived_at IS NULL`,
      [Number(req.session.user.id)]
    );
    res.json({success:true,message:"Todas las notificaciones fueron archivadas."});
  } catch(error) {
    logError("Error archivando notificaciones",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron archivar las notificaciones."});
  }
});

// =========================================================
// V2 — EMAIL / ESTADO DE ENTREGA
// =========================================================

app.get("/api/admin/email/status", requireAdmin, async (req,res) => {
  try {
    const [rows] = await pool.query(
      `SELECT status,COUNT(*) AS total,MAX(created_at) AS last_created,MAX(sent_at) AS last_sent
       FROM email_outbox GROUP BY status ORDER BY status`
    );
    res.json({
      success:true,
      smtp_configured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.MAIL_FROM),
      statuses: rows
    });
  } catch(error) {
    logError("Error obteniendo estado de email",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el estado del email."});
  }
});

app.get("/api/admin/email/outbox", requireAdmin, async (req,res) => {
  try {
    const limit=Math.min(Math.max(Number(req.query.limit)||50,1),100);
    const status=String(req.query.status||"").trim();
    const params=[];
    let sql=`SELECT id,to_email,subject,template,status,attempts,max_attempts,next_attempt_at,sent_at,last_error,provider_message_id,request_id,created_at,updated_at
              FROM email_outbox WHERE 1=1`;
    if(status){
      const allowed=["queued","sending","sent","failed","skipped"];
      if(!allowed.includes(status)) return res.status(400).json({error:"Estado de email inválido."});
      sql+=" AND status=?";
      params.push(status);
    }
    sql+=" ORDER BY id DESC LIMIT "+limit;
    const [rows]=await pool.query(sql,params);
    res.json({success:true,emails:rows});
  } catch(error) {
    logError("Error obteniendo cola de email",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener la cola de email."});
  }
});

// =========================================================
// V2 — WHATSAPP
// =========================================================

async function whatsappBusinessEnabled() {
  const [rows] = await pool.query(
    "SELECT whatsapp,whatsapp_enabled,whatsapp_auto_notifications FROM business_settings WHERE id=1 LIMIT 1"
  );
  return rows[0] || null;
}

app.get("/api/admin/whatsapp/status", requireAdmin, async (req,res) => {
  try {
    const settings=await whatsappBusinessEnabled();
    const [rows]=await pool.query(
      "SELECT status,COUNT(*) AS total,MAX(created_at) AS last_created,MAX(sent_at) AS last_sent FROM whatsapp_outbox GROUP BY status"
    );
    res.json({
      success:true,
      provider_configured: whatsappProviderConfigured(),
      settings: settings || null,
      statuses: rows
    });
  } catch(error) {
    logError("Error obteniendo estado de WhatsApp",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el estado de WhatsApp."});
  }
});

app.get("/api/admin/whatsapp/outbox", requireAdmin, async (req,res) => {
  try {
    const limit=Math.min(Math.max(Number(req.query.limit)||50,1),100);
    const status=String(req.query.status||"").trim();
    const params=[];
    let sql=`SELECT id,to_phone,message,status,attempts,max_attempts,next_attempt_at,sent_at,last_error,provider_message_id,entity_type,entity_id,request_id,created_at,updated_at
              FROM whatsapp_outbox WHERE 1=1`;
    if(status){
      const allowed=["queued","sending","sent","failed","skipped"];
      if(!allowed.includes(status)) return res.status(400).json({error:"Estado de WhatsApp inválido."});
      sql+=" AND status=?";
      params.push(status);
    }
    sql+=" ORDER BY id DESC LIMIT "+limit;
    const [rows]=await pool.query(sql,params);
    res.json({success:true,messages:rows});
  } catch(error) {
    logError("Error obteniendo outbox de WhatsApp",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener la cola de WhatsApp."});
  }
});

app.post("/api/admin/whatsapp/send", requireAdmin, adminMutationLimiter, async (req,res) => {
  try {
    const phone=String(req.body.phone||"").trim();
    const message=String(req.body.message||"").trim();
    if(!phone || !message) return res.status(400).json({error:"Teléfono y mensaje son obligatorios."});
    const result=await queueWhatsApp({
      to:phone,
      message,
      requestId:req.requestId,
      entityType:String(req.body.entity_type||"manual").slice(0,50),
      entityId:req.body.entity_id ? Number(req.body.entity_id) : null
    });
    await writeAudit(req,"whatsapp_queued","whatsapp",result.id,{phone:result.phone});
    res.json({success:true,...result});
  } catch(error) {
    logError("Error encolando WhatsApp manual",{requestId:req.requestId,error:error.message});
    res.status(400).json({error:error.message});
  }
});

app.post("/api/admin/whatsapp/link", requireAdmin, async (req,res) => {
  try {
    const phone=String(req.body.phone||"").trim();
    const message=String(req.body.message||"").trim();
    const link=buildWhatsAppLink(phone,message);
    if(!link) return res.status(400).json({error:"Número de WhatsApp inválido."});
    res.json({success:true,link});
  } catch(error) {
    res.status(400).json({error:"No se pudo generar el enlace de WhatsApp."});
  }
});

// =========================================================
// V2 — ACEPTACIÓN DIGITAL DE PRESUPUESTOS
// =========================================================

const ACCEPTANCE_CONSENT_TEXT =
  "Declaro que revisé el presupuesto, sus conceptos, importes y condiciones, y autorizo a JR Electricidad a registrar digitalmente mi decisión.";

function validatePublicCustomer(body) {
  const name = String(body?.name || "").trim().replace(/\s+/g," ");
  const email = String(body?.email || "").trim().toLowerCase();
  const phone = String(body?.phone || "").trim();
  const note = String(body?.note || "").trim();
  const signatureName = String(body?.signatureName || "").trim().replace(/\s+/g," ");
  if(name.length<2||name.length>150) return {error:"Ingresá un nombre válido."};
  if(!validEmail(email)) return {error:"Ingresá un email válido."};
  if(phone.length<6||phone.length>50) return {error:"Ingresá un teléfono válido."};
  if(note.length>2000) return {error:"La observación no puede superar 2000 caracteres."};
  if(signatureName.length<2||signatureName.length>150) return {error:"Ingresá tu nombre como firma digital."};
  return {name,email,phone,note,signatureName};
}

function publicQuoteToken(req) {
  const token=String(req.params.token||"").trim();
  return /^[A-Za-z0-9_-]{24,200}$/.test(token) ? token : null;
}

async function sendAcceptanceEmail({to,quoteNumber,decision,customerName}) {
  if (!to) return false;
  try {
    await queueEmail({
      to,
      subject: (decision==="aceptado"?"Aceptación":"Rechazo") + " de presupuesto " + quoteNumber + " - JR Electricidad",
      template: "quote_decision",
      data: { customerName, quoteNumber, decision }
    });
    return true;
  } catch(error) {
    logError("No se pudo encolar confirmación de aceptación", {
      requestId:null,
      error:error.message,
      quoteNumber
    });
    return false;
  }
}

async function processPublicQuoteDecision(req,res,decision) {
  const token=publicQuoteToken(req);
  if(!token) return res.status(404).json({error:"Presupuesto no encontrado o enlace inválido."});
  const customer=validatePublicCustomer(req.body||{});
  if(customer.error) return res.status(400).json({error:customer.error});
  if(decision==="aceptado"&&req.body?.consent!==true) {
    return res.status(400).json({error:"Debés aceptar la constancia digital antes de confirmar."});
  }

  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]=await connection.query(
      `SELECT q.*,qr.name AS client_name,qr.email AS client_email,qr.phone AS client_phone
       FROM quotes q
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE q.access_token=? LIMIT 1 FOR UPDATE`,
      [token]
    );
    if(!rows.length) {
      await connection.rollback();
      return res.status(404).json({error:"Presupuesto no encontrado o enlace inválido."});
    }

    const quote=rows[0];
    if(["cerrado","vencido"].includes(quote.status) ||
       (quote.expiration_date && new Date(quote.expiration_date).getTime() < new Date().setHours(0,0,0,0))) {
      await connection.rollback();
      return res.status(409).json({error:"Este presupuesto está vencido o cerrado y ya no admite una decisión."});
    }
    if(quote.status===decision) {
      await connection.rollback();
      return res.json({success:true,status:decision,already_decided:true,message:`El presupuesto ya figura como ${decision}.`});
    }
    if(quote.status!=="enviado") {
      await connection.rollback();
      return res.status(409).json({error:"Este presupuesto no está disponible para una nueva decisión."});
    }

    const ip=req.ip||null;
    const userAgent=String(req.get("user-agent")||"").slice(0,512)||null;

    const [insertResult]=await connection.query(
      `INSERT INTO quote_acceptances
       (quote_id,decision,customer_name,customer_email,customer_phone,customer_note,consent_text,signature_name,ip_address,user_agent)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [quote.id,decision,customer.name,customer.email,customer.phone,customer.note||null,
       decision==="aceptado"?ACCEPTANCE_CONSENT_TEXT:null,customer.signatureName,ip,userAgent]
    );

    if(decision==="aceptado") {
      await connection.query(
        "UPDATE quotes SET status='aceptado',accepted_at=NOW() WHERE id=?",
        [quote.id]
      );
      await connection.query(
        "UPDATE quote_requests SET status='aceptada' WHERE id=? AND status NOT IN ('cerrada','finalizada')",
        [quote.quote_request_id]
      );
      await connection.query(
        `INSERT INTO jobs (quote_id,status) VALUES (?, 'aceptado')
         ON DUPLICATE KEY UPDATE status='aceptado',updated_at=CURRENT_TIMESTAMP`,
        [quote.id]
      );
    } else {
      await connection.query(
        "UPDATE quotes SET status='rechazado',rejected_at=NOW() WHERE id=?",
        [quote.id]
      );
    }

    await connection.query(
      `INSERT INTO quote_history (quote_id,action,old_status,new_status,metadata)
       VALUES (?,'customer_decision','enviado',?,?)`,
      [quote.id,decision,JSON.stringify({
        source:"public",
        acceptance_id:insertResult.insertId,
        customer_name:customer.name,
        customer_email:customer.email,
        consent:decision==="aceptado"
      })]
    );

    await connection.query(
      "INSERT INTO admin_notifications (user_id,type,quote_id,entity_type,entity_id,message,link_url,priority,is_read,read_at,archived_at) VALUES (NULL,?,?,?,?,?,?,?,0,NULL,NULL)",
      [
        decision==="aceptado"?"quote_accepted":"quote_rejected",
        quote.id,
        "quote",
        quote.id,
        `El cliente ${quote.client_name} registró ${decision==="aceptado"?"la aceptación":"el rechazo"} del presupuesto ${quote.quote_number}.`,
        "/admin.html#quotesSection",
        "high"
      ]
    );

    await connection.commit();

    const emailSent=await sendAcceptanceEmail({
      to:customer.email,
      quoteNumber:quote.quote_number,
      decision,
      customerName:customer.name
    });

    await writeAudit(req,`quote_${decision}_public`,"quote",quote.id,{
      customer_name:customer.name,
      customer_email:customer.email,
      ip,
      user_agent:userAgent,
      email_sent:emailSent
    });

    res.json({
      success:true,
      status:decision,
      email_sent:emailSent,
      message:decision==="aceptado"
        ?"Presupuesto aceptado. Se registró tu aceptación y se creó el trabajo."
        :"Presupuesto rechazado. Se registró tu decisión correctamente."
    });
  } catch(error) {
    await connection.rollback().catch(()=>{});
    logError("Error procesando decisión pública del presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo registrar la decisión del presupuesto."});
  } finally {
    connection.release();
  }
}

app.post("/api/public/quotes/:token/accept",authLimiter,async(req,res)=>{
  return processPublicQuoteDecision(req,res,"aceptado");
});

app.post("/api/public/quotes/:token/reject",authLimiter,async(req,res)=>{
  return processPublicQuoteDecision(req,res,"rechazado");
});




// =========================================================
// FASE 14 — GESTIÓN CENTRALIZADA DE DOCUMENTOS
// =========================================================

function validateDocumentEntityId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function documentAbsolutePath(storedName) {
  const base = path.resolve(documentsDir);
  const target = path.resolve(base, String(storedName || ""));
  if (target !== base && !target.startsWith(base + path.sep)) {
    return null;
  }
  return target;
}

async function createStoredDocument({
  title,
  description = null,
  documentType,
  clientId = null,
  quoteRequestId = null,
  quoteId = null,
  jobId = null,
  originalName,
  mimeType,
  filePath,
  createdByUserId
}) {
  const type = normalizeDocumentType(documentType);
  if (!type) throw new Error("Tipo de documento inválido.");
  const stat = await fs.promises.stat(filePath);
  if (stat.size > MAX_DOCUMENT_SIZE) throw new Error("El documento supera los 10 MB.");
  const handle = await fs.promises.open(filePath, "r");
  const header = Buffer.alloc(16);
  try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }
  if (!validateDocumentSignature(header, mimeType)) {
    throw new Error("La firma del archivo no coincide con su tipo.");
  }

  const safeName = safeDocumentName(originalName);
  const storedName = path.basename(filePath);
  const sha256 = await sha256File(filePath);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [docResult] = await connection.query(
      `INSERT INTO documents
        (document_type,title,description,client_id,quote_request_id,quote_id,job_id,created_by_user_id,current_version)
       VALUES (?,?,?,?,?,?,?,?,1)`,
      [
        type,
        String(title || safeName).trim().slice(0,255) || safeName,
        description ? String(description).trim().slice(0,10000) : null,
        clientId, quoteRequestId, quoteId, jobId, createdByUserId || null
      ]
    );
    const documentId = Number(docResult.insertId);
    await connection.query(
      `INSERT INTO document_versions
        (document_id,version_number,original_name,stored_name,storage_path,mime_type,size_bytes,sha256,created_by_user_id)
       VALUES (?,1,?,?,?,?,?,?,?)`,
      [documentId, safeName, storedName, "documents/" + storedName, mimeType, stat.size, sha256, createdByUserId || null]
    );
    await connection.commit();
    return { documentId, version: 1, sha256, sizeBytes: stat.size };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function createDocumentVersion(documentId, file, userId) {
  const id = validateDocumentEntityId(documentId);
  if (!id) throw new Error("ID de documento inválido.");
  const stat = await fs.promises.stat(file.path);
  if (stat.size > MAX_DOCUMENT_SIZE) throw new Error("El documento supera los 10 MB.");
  const handle = await fs.promises.open(file.path, "r");
  const header = Buffer.alloc(16);
  try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }
  if (!validateDocumentSignature(header, file.mimetype)) throw new Error("La firma del archivo no coincide con su tipo.");

  const [docs] = await pool.query("SELECT id,current_version FROM documents WHERE id=? LIMIT 1", [id]);
  if (!docs.length) throw new Error("Documento no encontrado.");
  const version = Number(docs[0].current_version || 0) + 1;
  const sha256 = await sha256File(file.path);
  await pool.query(
    `INSERT INTO document_versions
      (document_id,version_number,original_name,stored_name,storage_path,mime_type,size_bytes,sha256,created_by_user_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id,version,safeDocumentName(file.originalname),path.basename(file.path),"documents/"+path.basename(file.path),file.mimetype,stat.size,sha256,userId || null]
  );
  await pool.query("UPDATE documents SET current_version=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [version,id]);
  return { version, sha256, sizeBytes: stat.size };
}

async function buildJobDocumentPdf(job, type) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(20).text("JR ELECTRICIDAD");
  doc.fillColor("#f59e0b").fontSize(9).text("Electricista Matriculado · Cat. 3");
  doc.moveDown(1.2);
  doc.fillColor("#111827").fontSize(16).text(type === "work_completion" ? "CONSTANCIA DE TRABAJO" : "INFORME DE TRABAJO");
  doc.moveDown(.8);
  const lines = [
    ["Trabajo", "#" + job.id],
    ["Cliente", job.client_name || "-"],
    ["Teléfono", job.client_phone || "-"],
    ["Servicio", job.service || "-"],
    ["Estado", job.status || "-"],
    ["Ubicación", job.location || "-"],
    ["Programado", job.scheduled_at ? new Date(job.scheduled_at).toLocaleString("es-AR") : "-"],
    ["Inicio", job.started_at ? new Date(job.started_at).toLocaleString("es-AR") : "-"],
    ["Finalización", job.completed_at ? new Date(job.completed_at).toLocaleString("es-AR") : "-"],
    ["Técnico", job.technician_name || "-"]
  ];
  for (const [label,value] of lines) {
    doc.fillColor("#6b7280").font("Helvetica-Bold").fontSize(9).text(label.toUpperCase());
    doc.fillColor("#111827").font("Helvetica").fontSize(11).text(String(value));
    doc.moveDown(.35);
  }
  if (job.execution_notes) {
    doc.moveDown(.4).fillColor("#111827").font("Helvetica-Bold").fontSize(10).text("NOTAS DE EJECUCIÓN");
    doc.font("Helvetica").fontSize(10).text(String(job.execution_notes));
  }
  if (job.completion_notes) {
    doc.moveDown(.4).fillColor("#111827").font("Helvetica-Bold").fontSize(10).text("NOTAS DE FINALIZACIÓN");
    doc.font("Helvetica").fontSize(10).text(String(job.completion_notes));
  }
  doc.moveDown(2);
  doc.fillColor("#6b7280").fontSize(8).text("Documento generado por el panel de administración de JR Electricidad.");
  return pdfToBuffer(doc);
}

async function createGeneratedPdfDocument({ title, type, pdf, clientId, quoteRequestId, quoteId, jobId, userId, fileName }) {
  const tmp = path.join(documentsDir, documentFileName(fileName || "documento.pdf"));
  await fs.promises.writeFile(tmp, pdf);
  try {
    return await createStoredDocument({
      title, documentType:type, clientId, quoteRequestId, quoteId, jobId,
      originalName:fileName || "documento.pdf",
      mimeType:"application/pdf", filePath:tmp, createdByUserId:userId
    });
  } catch (error) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw error;
  }
}

app.get("/api/admin/documents", requireAdmin, async (req,res)=>{
  try {
    const q=String(req.query.q||"").trim().slice(0,120);
    const type=String(req.query.type||"").trim();
    const params=[];
    const where=[];
    if(q){
      where.push("(d.title LIKE ? OR d.description LIKE ? OR dv.original_name LIKE ? OR c.name LIKE ?)");
      const like="%"+q+"%"; params.push(like,like,like,like);
    }
    if(type){
      const normalized=normalizeDocumentType(type);
      if(!normalized) return res.status(400).json({error:"Tipo de documento inválido."});
      where.push("d.document_type=?"); params.push(normalized);
    }
    const sql=`SELECT d.id,d.document_type,d.title,d.description,d.client_id,d.quote_request_id,d.quote_id,d.job_id,
      d.current_version,d.created_at,d.updated_at,
      dv.id AS version_id,dv.original_name,dv.mime_type,dv.size_bytes,dv.sha256,dv.created_at AS version_created_at,
      c.name AS client_name
      FROM documents d
      INNER JOIN document_versions dv ON dv.document_id=d.id AND dv.version_number=d.current_version
      LEFT JOIN clients c ON c.id=d.client_id
      ${where.length?"WHERE "+where.join(" AND "):""}
      ORDER BY d.updated_at DESC,d.id DESC LIMIT 200`;
    const [rows]=await pool.query(sql,params);
    res.json({types:DOCUMENT_TYPES,documents:rows});
  }catch(error){
    logError("Error listando documentos",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron obtener los documentos."});
  }
});

app.get("/api/admin/documents/:id(\\d+)", requireAdmin, async(req,res)=>{
  try{
    const id=validateDocumentEntityId(req.params.id);
    if(!id) return res.status(400).json({error:"ID de documento inválido."});
    const [docs]=await pool.query(
      `SELECT d.*,c.name AS client_name FROM documents d LEFT JOIN clients c ON c.id=d.client_id WHERE d.id=? LIMIT 1`,[id]);
    if(!docs.length) return res.status(404).json({error:"Documento no encontrado."});
    const [versions]=await pool.query(
      `SELECT v.id,v.version_number,v.original_name,v.mime_type,v.size_bytes,v.sha256,v.created_at,u.name AS created_by_name
       FROM document_versions v LEFT JOIN users u ON u.id=v.created_by_user_id WHERE v.document_id=? ORDER BY v.version_number DESC`,[id]);
    res.json({...docs[0],versions});
  }catch(error){res.status(500).json({error:"No se pudo obtener el documento."});}
});

app.get("/api/admin/documents/:id(\\d+)/download", requireAdmin, async(req,res)=>{
  try{
    const id=validateDocumentEntityId(req.params.id);
    const version=req.query.version==null?null:Number(req.query.version);
    if(!id) return res.status(400).json({error:"ID de documento inválido."});
    let sql=`SELECT d.title,v.* FROM documents d INNER JOIN document_versions v ON v.document_id=d.id
      WHERE d.id=? ${version? "AND v.version_number=?":"AND v.version_number=d.current_version"} LIMIT 1`;
    const params=version?[id,version]:[id];
    const [rows]=await pool.query(sql,params);
    if(!rows.length) return res.status(404).json({error:"Versión de documento no encontrada."});
    const filePath=documentAbsolutePath(rows[0].stored_name);
    if(!filePath || !fs.existsSync(filePath)) return res.status(404).json({error:"Archivo no encontrado en almacenamiento."});
    await writeAudit(req,"document_downloaded","document",id,{version:rows[0].version_number});
    res.setHeader("Content-Type",rows[0].mime_type);
    res.setHeader("Content-Disposition",`attachment; filename="${safeDocumentName(rows[0].original_name)}"`);
    res.sendFile(filePath);
  }catch(error){logError("Error descargando documento",{requestId:req.requestId,error:error.message});res.status(500).json({error:"No se pudo descargar el documento."});}
});

app.post("/api/admin/documents/upload", requireAdmin, adminMutationLimiter, documentUpload.single("file"), async(req,res)=>{
  try{
    if(!req.file) return res.status(400).json({error:"Seleccioná un archivo."});
    const documentType=normalizeDocumentType(req.body.document_type);
    if(!documentType){await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"Tipo de documento inválido."});}
    const result=await createStoredDocument({
      title:String(req.body.title||req.file.originalname).trim(),
      description:req.body.description,
      documentType,
      clientId:validateDocumentEntityId(req.body.client_id),
      quoteRequestId:validateDocumentEntityId(req.body.quote_request_id),
      quoteId:validateDocumentEntityId(req.body.quote_id),
      jobId:validateDocumentEntityId(req.body.job_id),
      originalName:req.file.originalname,mimeType:req.file.mimetype,filePath:req.file.path,
      createdByUserId:req.session.user.id
    });
    await writeAudit(req,"document_created","document",result.documentId,{document_type:documentType,version:1});
    res.status(201).json({success:true,...result});
  }catch(error){
    if(req.file) await fs.promises.unlink(req.file.path).catch(()=>{});
    logError("Error subiendo documento",{requestId:req.requestId,error:error.message});
    res.status(400).json({error:error.message||"No se pudo guardar el documento."});
  }
});

app.post("/api/admin/documents/:id(\\d+)/versions", requireAdmin, adminMutationLimiter, documentUpload.single("file"), async(req,res)=>{
  try{
    if(!req.file) return res.status(400).json({error:"Seleccioná un archivo."});
    const result=await createDocumentVersion(req.params.id,req.file,req.session.user.id);
    await writeAudit(req,"document_version_created","document",Number(req.params.id),{version:result.version});
    res.status(201).json({success:true,...result});
  }catch(error){
    if(req.file) await fs.promises.unlink(req.file.path).catch(()=>{});
    res.status(400).json({error:error.message||"No se pudo crear la versión."});
  }
});

app.post("/api/admin/documents/from-quote/:quoteId(\\d+)", requireAdmin, adminMutationLimiter, async(req,res)=>{
  try{
    const quoteId=validateDocumentEntityId(req.params.quoteId);
    if(!quoteId) return res.status(400).json({error:"ID de presupuesto inválido."});
    const quote=await getQuoteDetail(pool,quoteId);
    if(!quote) return res.status(404).json({error:"Presupuesto no encontrado."});
    const pdf=await pdfToBuffer(buildQuotePdf(quote));
    const result=await createGeneratedPdfDocument({
      title:"Presupuesto "+(quote.quote_number||quoteId),
      type:"quote_pdf",pdf,
      clientId:quote.client_id||null,quoteRequestId:quote.quote_request_id||null,quoteId,
      userId:req.session.user.id,fileName:`presupuesto-${quote.quote_number||quoteId}.pdf`
    });
    await writeAudit(req,"quote_document_generated","document",result.documentId,{quote_id:quoteId});
    res.status(201).json({success:true,...result});
  }catch(error){logError("Error generando documento de presupuesto",{requestId:req.requestId,error:error.message});res.status(500).json({error:"No se pudo generar el PDF del presupuesto."});}
});

app.post("/api/admin/documents/from-job/:jobId(\\d+)", requireAdmin, adminMutationLimiter, async(req,res)=>{
  try{
    const jobId=validateDocumentEntityId(req.params.jobId);
    if(!jobId) return res.status(400).json({error:"ID de trabajo inválido."});
    const [rows]=await pool.query(
      `SELECT j.*,qr.name AS client_name,qr.phone AS client_phone,qr.service,qu.quote_number,
        u.name AS technician_name,c.id AS client_id
       FROM jobs j
       LEFT JOIN quote_requests qr ON qr.id=j.quote_request_id
       LEFT JOIN quotes qu ON qu.id=j.quote_id
       LEFT JOIN clients c ON c.id=qr.client_id
       LEFT JOIN users u ON u.id=j.assigned_user_id
       WHERE j.id=? LIMIT 1`,[jobId]);
    if(!rows.length) return res.status(404).json({error:"Trabajo no encontrado."});
    const type=String(req.body.type||"job_report")==="work_completion"?"work_completion":"job_report";
    const pdf=await buildJobDocumentPdf(rows[0],type);
    const result=await createGeneratedPdfDocument({
      title:(type==="work_completion"?"Constancia de trabajo #":"Informe de trabajo #")+jobId,
      type,pdf,clientId:rows[0].client_id||null,quoteRequestId:rows[0].quote_request_id||null,quoteId:rows[0].quote_id||null,jobId,
      userId:req.session.user.id,fileName:`${type}-${jobId}.pdf`
    });
    await writeAudit(req,"job_document_generated","document",result.documentId,{job_id:jobId,type});
    res.status(201).json({success:true,...result});
  }catch(error){logError("Error generando documento de trabajo",{requestId:req.requestId,error:error.message});res.status(500).json({error:"No se pudo generar el documento del trabajo."});}
});

app.delete("/api/admin/documents/:id(\\d+)", requireAdmin, adminMutationLimiter, async(req,res)=>{
  const connection=await pool.getConnection();
  try{
    const id=validateDocumentEntityId(req.params.id);
    if(!id){connection.release();return res.status(400).json({error:"ID de documento inválido."});}
    const [versions]=await connection.query("SELECT stored_name FROM document_versions WHERE document_id=?",[id]);
    const [result]=await connection.query("DELETE FROM documents WHERE id=?",[id]);
    if(!result.affectedRows){connection.release();return res.status(404).json({error:"Documento no encontrado."});}
    await connection.commit().catch(()=>{});
    connection.release();
    for(const row of versions){const p=documentAbsolutePath(row.stored_name);if(p) await fs.promises.unlink(p).catch(()=>{});}
    await writeAudit(req,"document_deleted","document",id,{versions:versions.length});
    res.json({success:true,message:"Documento eliminado."});
  }catch(error){await connection.rollback().catch(()=>{});connection.release();res.status(500).json({error:"No se pudo eliminar el documento."});}
});

app.get("/api/admin/documents/:id(\\d+)/versions", requireAdmin, async(req,res)=>{
  try{
    const id=validateDocumentEntityId(req.params.id);
    if(!id) return res.status(400).json({error:"ID de documento inválido."});
    const [rows]=await pool.query(
      `SELECT v.*,u.name AS created_by_name FROM document_versions v LEFT JOIN users u ON u.id=v.created_by_user_id WHERE v.document_id=? ORDER BY v.version_number DESC`,[id]);
    res.json(rows);
  }catch(error){res.status(500).json({error:"No se pudieron obtener las versiones."});}
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

start();, 'PR-', 'TR-')
    ON DUPLICATE KEY UPDATE id = id
  `);
}

async function nextDocumentNumber(connection, type) {
  const prefixField = type === "job" ? "job_prefix" : "quote_prefix";
  const nextField = type === "job" ? "job_next_number" : "quote_next_number";
  const [rows] = await connection.query(
    `SELECT ${prefixField} AS prefix, ${nextField} AS next_number
     FROM business_settings WHERE id=1 LIMIT 1 FOR UPDATE`
  );
  const row = rows[0] || {};
  const prefix = String(row.prefix || (type === "job" ? "TR-" : "PR-")).trim();
  const next = Math.max(1, Number(row.next_number || 1));
  await connection.query(
    `UPDATE business_settings SET ${nextField}=? WHERE id=1`,
    [next + 1]
  );
  return prefix + String(next).padStart(6, "0");
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
        whatsapp_enabled: Boolean(req.body.whatsapp_enabled),
        whatsapp_auto_notifications: Boolean(req.body.whatsapp_auto_notifications),
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
            whatsapp_enabled=?, whatsapp_auto_notifications=?,
            email=?, address=?, city=?, hours=?, logo_url=?,
            pdf_footer=?, pdf_notes=?
        WHERE id=1
        `,
        [
          fields.business_name,
          fields.legal_name,
          fields.phone,
          fields.whatsapp,
          fields.whatsapp_enabled ? 1 : 0,
          fields.whatsapp_auto_notifications ? 1 : 0,
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
  async (req, res) => {
    if (!req.session.user) return res.json({ user: null });

    try {
      const [rows] = await pool.query(
        `SELECT id, name, email, role, email_verified_at, pending_email, avatar_url, totp_enabled
         FROM users WHERE id=? LIMIT 1`,
        [Number(req.session.user.id)]
      );
      if (!rows.length) return res.json({ user: null });

      req.session.user = {
        ...req.session.user,
        id: rows[0].id,
        name: rows[0].name,
        email: rows[0].email,
        role: rows[0].role
      };

      res.json({ user: cleanUser(rows[0]) });
    } catch (error) {
      logError("Error obteniendo usuario actual", { requestId: req.requestId, error: error.message });
      res.status(500).json({ error: "No se pudo obtener la cuenta." });
    }
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

      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({ error: passwordError });
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
      await registerActiveSession(req, result.insertId);
      await writeAudit(req, "register", "user", result.insertId);
      try {
        await sendEmailVerification(result.insertId, normalized);
      } catch (mailError) {
        logError("No se pudo enviar verificación tras registro", {
          requestId: req.requestId,
          userId: result.insertId,
          error: mailError.message
        });
      }

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
            created_at,
            email_verified_at,
            avatar_url,
            totp_enabled
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
    const userId = req.session?.user?.id || null;
    const sessionId = req.sessionID;

    req.session.destroy(
      () => {
        removeActiveSession(sessionId);
        if (userId) {
          writeAudit(req, "logout", "user", userId);
        }

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
        password.length < PASSWORD_MIN ||
        password.length > PASSWORD_MAX
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

    // V2: vincular automáticamente la solicitud con un cliente existente.
    let clientId = null;
    const clientQuery = await pool.query("SELECT id FROM clients WHERE phone=? LIMIT 1", [cleanPhone]);
    const clientRows = clientQuery[0];
    if (clientRows.length) {
      clientId = clientRows[0].id;
      await pool.query(
        `UPDATE clients SET name=?, email=COALESCE(NULLIF(?, ''), email) WHERE id=?`,
        [cleanName, cleanEmail || "", clientId]
      );
    } else {
      const clientQueryResult = await pool.query(
        `INSERT INTO clients (name, phone, email) VALUES (?, ?, ?)`,
        [cleanName, cleanPhone, cleanEmail || null]
      );
      clientId = clientQueryResult[0].insertId;
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
        image_url,
        client_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        cleanName,
        cleanPhone,
        cleanEmail,
        cleanService,
        cleanDescription,
        preferred_date || null,
        imageUrl,
        clientId
      ]
    );

    // La solicitud ya fue guardada correctamente. La notificación
    // nunca debe hacer fallar el envío de la solicitud.
    try {
      await createAdminNotification({
        type: "quote_request_created",
        message: `Nueva solicitud de presupuesto de ${cleanName}.`,
        entityType: "quote_request",
        entityId: result.insertId,
        linkUrl: "/admin.html#quoteRequestsSection",
        priority: "high"
      });
    } catch (notificationError) {
      logError("Solicitud guardada, pero no se pudo crear la notificación", {
        requestId: req.requestId,
        error: notificationError.message
      });
    }

    const [createdRequestRows] = await pool.query(
      "SELECT id,name,email,phone,whatsapp,service,status FROM quote_requests WHERE id=? LIMIT 1",
      [result.insertId]
    );
    if (createdRequestRows.length) {
      await notifyRequestCustomer(
        createdRequestRows[0],
        "Solicitud recibida - JR Electricidad",
        "Recibimos correctamente tu solicitud de presupuesto."
      );
      await notifyRequestWhatsApp(
        createdRequestRows[0],
        `JR Electricidad: recibimos tu solicitud #${createdRequestRows[0].id}. Te contactaremos luego de revisarla.`
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
// GALERÍA V2 — PÚBLICA + ADMIN
// =========================================================

const GALLERY_CATEGORIES = [
  "instalaciones",
  "reparaciones",
  "tableros",
  "iluminacion",
  "mantenimiento",
  "otros"
];

function parseOptionalId(value) {
  if (value === "" || value === null || value === undefined) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateGalleryCategory(value) {
  const category = String(value || "otros").trim().toLowerCase();
  return GALLERY_CATEGORIES.includes(category) ? category : null;
}

function galleryCategoryLabel(category) {
  return ({
    instalaciones: "Instalaciones",
    reparaciones: "Reparaciones",
    tableros: "Tableros eléctricos",
    iluminacion: "Iluminación",
    mantenimiento: "Mantenimiento",
    otros: "Otros"
  })[category] || "Otros";
}

async function validateGalleryRelations({ clientId, jobId, quoteId }) {
  if (clientId !== null) {
    const [rows] = await pool.query("SELECT id FROM clients WHERE id=? LIMIT 1", [clientId]);
    if (!rows.length) return "El cliente vinculado no existe.";
  }
  if (quoteId !== null) {
    const [rows] = await pool.query("SELECT id, quote_request_id FROM quotes WHERE id=? LIMIT 1", [quoteId]);
    if (!rows.length) return "El presupuesto vinculado no existe.";
  }
  if (jobId !== null) {
    const [rows] = await pool.query(
      "SELECT j.id, j.status, j.quote_id FROM jobs j WHERE j.id=? LIMIT 1",
      [jobId]
    );
    if (!rows.length) return "El trabajo vinculado no existe.";
    if (!["finalizado", "cerrado"].includes(rows[0].status)) {
      return "Solo se pueden publicar trabajos de la galería vinculados a trabajos finalizados o cerrados.";
    }
  }
  if (jobId !== null && quoteId !== null) {
    const [rows] = await pool.query("SELECT id FROM jobs WHERE id=? AND quote_id=? LIMIT 1", [jobId, quoteId]);
    if (!rows.length) return "El trabajo y el presupuesto vinculados no corresponden entre sí.";
  }
  if (jobId !== null && clientId !== null) {
    const [rows] = await pool.query(
      "SELECT j.id FROM jobs j INNER JOIN quotes q ON q.id=j.quote_id INNER JOIN quote_requests qr ON qr.id=q.quote_request_id WHERE j.id=? AND qr.client_id=? LIMIT 1",
      [jobId, clientId]
    );
    if (!rows.length) return "El trabajo y el cliente vinculados no corresponden entre sí.";
  }
  return null;
}

async function deleteGalleryFile(imageUrl) {
  if (!imageUrl || !String(imageUrl).startsWith("/uploads/")) return;
  const imageFile = path.join(__dirname, "public", String(imageUrl).replace(/^\/+/, ""));
  if (fs.existsSync(imageFile)) await fs.promises.unlink(imageFile).catch(() => {});
}

app.get("/api/gallery", async (req, res) => {
  try {
    const category = String(req.query.category || "").trim().toLowerCase();
    const params = [];
    let sql = "SELECT id,title,description,image_url,alt_text,category,featured,sort_order,client_id,job_id,quote_id,created_at FROM gallery WHERE active=1";
    if (category && GALLERY_CATEGORIES.includes(category)) {
      sql += " AND category=?";
      params.push(category);
    }
    sql += " ORDER BY featured DESC,sort_order ASC,created_at DESC";
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo galería pública", {requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron cargar los trabajos."});
  }
});

app.get("/api/admin/gallery", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const category = String(req.query.category || "").trim().toLowerCase();
    const status = String(req.query.status || "").trim().toLowerCase();
    const params = [];
    let sql = "SELECT g.id,g.title,g.description,g.image_url,g.alt_text,g.active,g.featured,g.sort_order,g.category,g.client_id,g.job_id,g.quote_id,g.created_at,g.updated_at,c.name AS client_name,j.status AS job_status,q.quote_number FROM gallery g LEFT JOIN clients c ON c.id=g.client_id LEFT JOIN jobs j ON j.id=g.job_id LEFT JOIN quotes q ON q.id=g.quote_id WHERE 1=1";
    if (search) {
      const v = "%" + search + "%";
      sql += " AND (g.title LIKE ? OR g.description LIKE ? OR g.alt_text LIKE ? OR g.category LIKE ? OR c.name LIKE ? OR q.quote_number LIKE ?)";
      params.push(v,v,v,v,v,v);
    }
    if (category && GALLERY_CATEGORIES.includes(category)) {
      sql += " AND g.category=?";
      params.push(category);
    }
    if (status === "active") sql += " AND g.active=1";
    if (status === "inactive") sql += " AND g.active=0";
    if (status === "featured") sql += " AND g.featured=1";
    sql += " ORDER BY g.sort_order ASC,g.created_at DESC";
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo galería admin", {requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron cargar los trabajos."});
  }
});

app.get("/api/admin/gallery/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query(
      "SELECT g.*,c.name AS client_name,j.status AS job_status,q.quote_number FROM gallery g LEFT JOIN clients c ON c.id=g.client_id LEFT JOIN jobs j ON j.id=g.job_id LEFT JOIN quotes q ON q.id=g.quote_id WHERE g.id=? LIMIT 1",
      [id]
    );
    if (!rows.length) return res.status(404).json({error:"Trabajo de galería no encontrado."});
    res.json(rows[0]);
  } catch (error) {
    logError("Error obteniendo detalle de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el trabajo de galería."});
  }
});

app.post("/api/admin/gallery", requireAdmin, adminMutationLimiter, upload.single("image"), validateUploadedImage, async (req, res) => {
  try {
    const title=String(req.body.title||"").trim();
    const description=String(req.body.description||"").trim();
    const altText=String(req.body.alt_text||req.body.altText||title).trim();
    const category=validateGalleryCategory(req.body.category);
    const active=["true","1"].includes(String(req.body.active))?1:0;
    const featured=["true","1"].includes(String(req.body.featured))?1:0;
    const clientId=parseOptionalId(req.body.client_id);
    const jobId=parseOptionalId(req.body.job_id);
    const quoteId=parseOptionalId(req.body.quote_id);

    if(!title||title.length>150){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El título es obligatorio y no puede superar 150 caracteres."});}
    if(description.length>500){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"La descripción no puede superar 500 caracteres."});}
    if(!altText||altText.length>255){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El texto alternativo es obligatorio y no puede superar 255 caracteres."});}
    if(!category){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"La categoría seleccionada no es válida."});}
    const relationError=await validateGalleryRelations({clientId,jobId,quoteId});
    if(relationError){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:relationError});}
    if(!req.file)return res.status(400).json({error:"Debes seleccionar una imagen."});

    const imageUrl="/uploads/"+req.file.filename;
    const [[orderRow]]=await pool.query("SELECT COALESCE(MAX(sort_order),0)+1 AS next_order FROM gallery");
    const sortOrder=Number(orderRow.next_order||1);
    const [result]=await pool.query(
      "INSERT INTO gallery (title,description,image_url,alt_text,category,active,featured,sort_order,client_id,job_id,quote_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [title,description,imageUrl,altText,category,active,featured,sortOrder,clientId,jobId,quoteId]
    );
    await writeAudit(req,"gallery_created","gallery",result.insertId,{category,featured,jobId,quoteId,clientId});
    if (active) {
      await createAdminNotification({
        type: "gallery_published",
        message: `La galería publicó "${title}".`,
        entityType: "gallery",
        entityId: result.insertId,
        quoteId,
        linkUrl: "/admin.html#gallerySection",
        priority: featured ? "high" : "normal"
      }).catch(() => {});
    }
    res.status(201).json({ok:true,message:"Trabajo agregado correctamente.",id:result.insertId,image_url:imageUrl});
  } catch(error) {
    if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});
    logError("Error agregando trabajo de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo agregar el trabajo."});
  }
});

app.put("/api/admin/gallery/:id(\\d+)", requireAdmin, adminMutationLimiter, upload.single("image"), validateUploadedImage, async (req, res) => {
  try {
    const id=Number(req.params.id);
    const [[existing]]=await pool.query("SELECT * FROM gallery WHERE id=? LIMIT 1",[id]);
    if(!existing){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(404).json({error:"Trabajo no encontrado."});}

    const title=String(req.body.title||"").trim();
    const description=String(req.body.description||"").trim();
    const altText=String(req.body.alt_text||req.body.altText||title).trim();
    const category=validateGalleryCategory(req.body.category);
    const active=["true","1"].includes(String(req.body.active))?1:0;
    const featured=["true","1"].includes(String(req.body.featured))?1:0;
    const clientId=parseOptionalId(req.body.client_id);
    const jobId=parseOptionalId(req.body.job_id);
    const quoteId=parseOptionalId(req.body.quote_id);

    if(!title||title.length>150){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El título es obligatorio y no puede superar 150 caracteres."});}
    if(description.length>500){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"La descripción no puede superar 500 caracteres."});}
    if(!altText||altText.length>255){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"El texto alternativo es obligatorio y no puede superar 255 caracteres."});}
    if(!category){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"La categoría seleccionada no es válida."});}

    const relationError=await validateGalleryRelations({clientId,jobId,quoteId});
    if(relationError){if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:relationError});}

    let imageUrl=existing.image_url;
    if(req.file)imageUrl="/uploads/"+req.file.filename;

    await pool.query(
      "UPDATE gallery SET title=?,description=?,image_url=?,alt_text=?,category=?,active=?,featured=?,client_id=?,job_id=?,quote_id=? WHERE id=?",
      [title,description,imageUrl,altText,category,active,featured,clientId,jobId,quoteId,id]
    );
    if(req.file&&existing.image_url!==imageUrl&&!existing.source_job_attachment_id)await deleteGalleryFile(existing.image_url);
    await writeAudit(req,"gallery_updated","gallery",id,{category,featured,jobId,quoteId,clientId});
    if (!Number(existing.active) && active) {
      await createAdminNotification({
        type: "gallery_published",
        message: `La galería publicó "${title}".`,
        entityType: "gallery",
        entityId: id,
        quoteId,
        linkUrl: "/admin.html#gallerySection",
        priority: featured ? "high" : "normal"
      }).catch(() => {});
    }
    res.json({ok:true,message:"Trabajo actualizado correctamente."});
  }catch(error){
    if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});
    logError("Error editando trabajo de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el trabajo."});
  }
});

app.delete("/api/admin/gallery/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req,res)=>{
  try{
    const id=Number(req.params.id);
    const [[existing]]=await pool.query("SELECT image_url,source_job_attachment_id FROM gallery WHERE id=? LIMIT 1",[id]);
    if(!existing)return res.status(404).json({error:"Trabajo no encontrado."});
    await pool.query("DELETE FROM gallery WHERE id=?",[id]);
    if(!existing.source_job_attachment_id)await deleteGalleryFile(existing.image_url);
    await writeAudit(req,"gallery_deleted","gallery",id);
    res.json({ok:true,message:"Trabajo eliminado correctamente."});
  }catch(error){
    logError("Error eliminando trabajo de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo eliminar el trabajo."});
  }
});

app.put("/api/admin/gallery/:id(\\d+)/order", requireAdmin, adminMutationLimiter, async (req,res)=>{
  try{
    const id=Number(req.params.id);
    const direction=String(req.body.direction||"");
    if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:"ID inválido."});
    if(!["up","down"].includes(direction))return res.status(400).json({error:"Dirección inválida."});
    const [[current]]=await pool.query("SELECT id,sort_order FROM gallery WHERE id=? LIMIT 1",[id]);
    if(!current)return res.status(404).json({error:"Trabajo no encontrado."});
    const comparison=direction==="up"?"<":">";
    const orderDirection=direction==="up"?"DESC":"ASC";
    const [[neighbor]]=await pool.query(
      "SELECT id,sort_order FROM gallery WHERE sort_order "+comparison+" ? ORDER BY sort_order "+orderDirection+", id "+orderDirection+" LIMIT 1",
      [current.sort_order]
    );
    if(!neighbor)return res.json({ok:true,message:direction==="up"?"Ya está primero.":"Ya está último."});
    await pool.query("UPDATE gallery SET sort_order=? WHERE id=?",[neighbor.sort_order,current.id]);
    await pool.query("UPDATE gallery SET sort_order=? WHERE id=?",[current.sort_order,neighbor.id]);
    await writeAudit(req,"gallery_reordered","gallery",id,{direction});
    res.json({ok:true,message:"Orden actualizado correctamente."});
  }catch(error){
    logError("Error cambiando orden de galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo cambiar el orden."});
  }
});

app.post("/api/admin/gallery/from-job-attachment/:attachmentId(\\d+)", requireAdmin, adminMutationLimiter, async (req,res)=>{
  try{
    const attachmentId=Number(req.params.attachmentId);
    const [[attachment]]=await pool.query(
      "SELECT ja.*,j.status AS job_status,j.quote_id,qr.client_id,qr.service,qr.description,q.quote_number FROM job_attachments ja INNER JOIN jobs j ON j.id=ja.job_id INNER JOIN quotes q ON q.id=j.quote_id INNER JOIN quote_requests qr ON qr.id=q.quote_request_id WHERE ja.id=? LIMIT 1",
      [attachmentId]
    );
    if(!attachment)return res.status(404).json({error:"La evidencia no existe."});
    if(!["image/jpeg","image/png","image/webp","image/gif"].includes(attachment.mime_type))return res.status(400).json({error:"Solo se pueden publicar imágenes como trabajos de galería."});
    if(!["finalizado","cerrado"].includes(attachment.job_status))return res.status(400).json({error:"Solo se pueden publicar evidencias de trabajos finalizados o cerrados."});

    const title=String(req.body.title||attachment.service||"Trabajo realizado").trim();
    const description=String(req.body.description||attachment.description||"").trim();
    const altText=String(req.body.alt_text||title).trim();
    const category=validateGalleryCategory(req.body.category||"otros");
    const active=["true","1"].includes(String(req.body.active??"1"))?1:0;
    const featured=["true","1"].includes(String(req.body.featured))?1:0;
    if(!title||title.length>150)return res.status(400).json({error:"El título es obligatorio y no puede superar 150 caracteres."});
    if(description.length>500)return res.status(400).json({error:"La descripción no puede superar 500 caracteres."});
    if(!altText||altText.length>255)return res.status(400).json({error:"El texto alternativo no es válido."});
    if(!category)return res.status(400).json({error:"La categoría no es válida."});

    const [[duplicate]]=await pool.query("SELECT id FROM gallery WHERE job_id=? AND image_url=? LIMIT 1",[attachment.job_id,attachment.url]);
    if(duplicate)return res.status(409).json({error:"Esta evidencia ya está publicada en la galería.",id:duplicate.id});

    const [[orderRow]]=await pool.query("SELECT COALESCE(MAX(sort_order),0)+1 AS next_order FROM gallery");
    const [result]=await pool.query(
      "INSERT INTO gallery (title,description,image_url,alt_text,category,active,featured,sort_order,client_id,job_id,quote_id,source_job_attachment_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [title,description,attachment.url,altText,category,active,featured,Number(orderRow.next_order||1),attachment.client_id||null,attachment.job_id,attachment.quote_id,attachmentId]
    );
    await writeAudit(req,"gallery_promoted_from_job_attachment","gallery",result.insertId,{attachmentId,jobId:attachment.job_id});
    if (active) {
      await createAdminNotification({
        type: "gallery_published",
        message: `La evidencia del trabajo #${attachment.job_id} fue publicada en la galería.`,
        entityType: "gallery",
        entityId: result.insertId,
        quoteId: attachment.quote_id,
        linkUrl: "/admin.html#gallerySection",
        priority: featured ? "high" : "normal"
      }).catch(() => {});
    }
    res.status(201).json({ok:true,id:result.insertId,message:"La evidencia fue publicada en la galería."});
  }catch(error){
    logError("Error promocionando evidencia a galería",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo publicar la evidencia en la galería."});
  }
});

app.get("/api/admin/gallery/categories", requireAdmin, (req,res)=>{
  res.json(GALLERY_CATEGORIES.map(value=>({value,label:galleryCategoryLabel(value)})));
});

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
// ADMIN - CLIENTES V2
// =========================================================

function cleanClientInput(body) {
  return {
    name: String(body.name || "").trim(),
    phone: String(body.phone || "").trim(),
    whatsapp: String(body.whatsapp || "").trim(),
    email: normalizeEmail(body.email),
    address: String(body.address || "").trim(),
    locality: String(body.locality || "").trim(),
    notes: String(body.notes || "").trim()
  };
}

function validateClientInput(client) {
  if (!client.name || client.name.length > 150) return "El nombre es obligatorio y no puede superar 150 caracteres.";
  if (!client.phone || client.phone.length > 50) return "El teléfono es obligatorio y no puede superar 50 caracteres.";
  if (client.whatsapp.length > 50) return "El WhatsApp no puede superar 50 caracteres.";
  if (client.email && !validEmail(client.email)) return "El email del cliente no es válido.";
  if (client.address.length > 255) return "La dirección no puede superar 255 caracteres.";
  if (client.locality.length > 120) return "La localidad no puede superar 120 caracteres.";
  if (client.notes.length > 5000) return "Las notas no pueden superar 5000 caracteres.";
  return null;
}

app.get("/api/admin/clients", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const locality = String(req.query.locality || "").trim();
    const params = [];
    let sql = `
      SELECT
        c.id, c.user_id, c.name, c.phone, c.whatsapp, c.email,
        c.address, c.locality, c.notes, c.created_at, c.updated_at,
        COUNT(DISTINCT qr.id) AS requests,
        COUNT(DISTINCT q.id) AS quotes,
        COUNT(DISTINCT j.id) AS jobs,
        MAX(COALESCE(j.updated_at, q.updated_at, qr.created_at, c.updated_at)) AS last_activity
      FROM clients c
      LEFT JOIN quote_requests qr ON qr.client_id=c.id
      LEFT JOIN quotes q ON q.quote_request_id=qr.id
      LEFT JOIN jobs j ON j.quote_id=q.id
      WHERE 1=1
    `;

    if (search) {
      sql += ` AND (c.name LIKE ? OR c.phone LIKE ? OR c.whatsapp LIKE ? OR c.email LIKE ? OR c.address LIKE ? OR c.locality LIKE ?) `;
      const v = `%${search}%`;
      params.push(v,v,v,v,v,v);
    }
    if (locality) {
      sql += " AND c.locality LIKE ?";
      params.push(`%${locality}%`);
    }

    sql += `
      GROUP BY c.id
      ORDER BY last_activity DESC, c.name ASC
    `;

    const [rows] = await pool.query(sql, params);
    res.json({
      success: true,
      clients: rows.map(c => ({
        ...c,
        requests: Number(c.requests || 0),
        quotes: Number(c.quotes || 0),
        jobs: Number(c.jobs || 0)
      }))
    });
  } catch (error) {
    logError("Error obteniendo clientes", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener los clientes." });
  }
});

app.post("/api/admin/clients", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const client = cleanClientInput(req.body);
    const validationError = validateClientInput(client);
    if (validationError) return res.status(400).json({ error: validationError });

    const [existing] = await pool.query("SELECT id FROM clients WHERE phone=? LIMIT 1", [client.phone]);
    if (existing.length) return res.status(409).json({ error: "Ya existe un cliente con ese teléfono." });

    const [result] = await pool.query(
      `INSERT INTO clients (name,phone,whatsapp,email,address,locality,notes)
       VALUES (?,?,?,?,?,?,?)`,
      [client.name,client.phone,client.whatsapp||null,client.email||null,client.address||null,client.locality||null,client.notes||null]
    );
    await writeAudit(req, "client_created", "client", result.insertId);
    res.status(201).json({ success:true, client:{ id:result.insertId, ...client } });
  } catch (error) {
    logError("Error creando cliente", { requestId:req.requestId, error:error.message });
    res.status(500).json({ error:"No se pudo crear el cliente." });
  }
});

app.get("/api/admin/clients/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id=Number(req.params.id);
    if (!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de cliente inválido."});
    const [rows]=await pool.query("SELECT * FROM clients WHERE id=? LIMIT 1",[id]);
    if (!rows.length) return res.status(404).json({error:"Cliente no encontrado."});
    res.json({success:true,client:rows[0]});
  } catch(error) {
    logError("Error obteniendo cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el cliente."});
  }
});

app.put("/api/admin/clients/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const id=Number(req.params.id);
    if (!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de cliente inválido."});
    const client=cleanClientInput(req.body);
    const validationError=validateClientInput(client);
    if (validationError) return res.status(400).json({error:validationError});

    const [existing]=await pool.query("SELECT id FROM clients WHERE phone=? AND id<>? LIMIT 1",[client.phone,id]);
    if(existing.length) return res.status(409).json({error:"Ya existe otro cliente con ese teléfono."});

    const [result]=await pool.query(
      `UPDATE clients SET name=?,phone=?,whatsapp=?,email=?,address=?,locality=?,notes=? WHERE id=?`,
      [client.name,client.phone,client.whatsapp||null,client.email||null,client.address||null,client.locality||null,client.notes||null,id]
    );
    if(!result.affectedRows) return res.status(404).json({error:"Cliente no encontrado."});
    await writeAudit(req,"client_updated","client",id);
    const [rows]=await pool.query("SELECT * FROM clients WHERE id=? LIMIT 1",[id]);
    res.json({success:true,message:"Cliente actualizado correctamente.",client:rows[0]});
  } catch(error) {
    logError("Error actualizando cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el cliente."});
  }
});

app.delete("/api/admin/clients/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de cliente inválido."});
    const [result]=await pool.query("DELETE FROM clients WHERE id=?",[id]);
    if(!result.affectedRows) return res.status(404).json({error:"Cliente no encontrado."});
    await writeAudit(req,"client_deleted","client",id);
    res.json({success:true,message:"Cliente eliminado correctamente."});
  } catch(error) {
    logError("Error eliminando cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo eliminar el cliente."});
  }
});

app.get("/api/admin/clients/:id(\\d+)/history", requireAdmin, async (req, res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de cliente inválido."});

    const [clientRows]=await pool.query("SELECT * FROM clients WHERE id=? LIMIT 1",[id]);
    if(!clientRows.length) return res.status(404).json({error:"Cliente no encontrado."});

    const [requests]=await pool.query(
      `SELECT id,name,phone,email,service,description,preferred_date,image_url,status,created_at
       FROM quote_requests WHERE client_id=? ORDER BY created_at DESC`,[id]
    );
    const [quotes]=await pool.query(
      `SELECT q.id,q.quote_number,q.issue_date,q.expiration_date,q.status,q.subtotal,q.discount,q.total,
              q.created_at,q.updated_at,j.id AS job_id,j.status AS job_status,j.started_at,j.completed_at
       FROM quotes q
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       LEFT JOIN jobs j ON j.quote_id=q.id
       WHERE qr.client_id=? ORDER BY q.created_at DESC`,[id]
    );
    const [jobs]=await pool.query(
      `SELECT j.id,j.quote_id,j.status,j.started_at,j.completed_at,j.created_at,j.updated_at,
              q.quote_number, q.total,
              qr.service,qr.description
       FROM jobs j
       INNER JOIN quotes q ON q.id=j.quote_id
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE qr.client_id=? ORDER BY j.created_at DESC`,[id]
    );

    res.json({
      success:true,
      client:clientRows[0],
      requests,quotes,jobs,
      summary:{
        requests:requests.length,
        quotes:quotes.length,
        jobs:jobs.length,
        completedJobs:jobs.filter(j=>j.status==="cerrado").length,
        totalQuoted:quotes.reduce((sum,q)=>sum+Number(q.total||0),0)
      }
    });
  } catch(error) {
    logError("Error obteniendo historial del cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el historial del cliente."});
  }
});

// Compatibilidad V1: ficha por teléfono/email.
app.get("/api/admin/clients/detail", requireAdmin, async (req,res)=>{
  try {
    const phone=String(req.query.phone||"").trim();
    const email=normalizeEmail(req.query.email);
    if(!phone) return res.status(400).json({error:"El teléfono del cliente es obligatorio."});
    const [rows]=await pool.query("SELECT id FROM clients WHERE phone=? LIMIT 1",[phone]);
    if(!rows.length) return res.status(404).json({error:"No se encontró el cliente."});
    const id=rows[0].id;
    const [clientRows]=await pool.query("SELECT * FROM clients WHERE id=? LIMIT 1",[id]);
    const [requests]=await pool.query("SELECT id,name,phone,email,service,description,preferred_date,image_url,status,created_at FROM quote_requests WHERE client_id=? ORDER BY created_at DESC",[id]);
    const [quotes]=await pool.query(
      `SELECT q.id,q.quote_number,q.issue_date,q.expiration_date,q.status,q.subtotal,q.discount,q.total,q.created_at,q.updated_at,
              j.id AS job_id,j.status AS job_status,j.started_at,j.completed_at
       FROM quotes q INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       LEFT JOIN jobs j ON j.quote_id=q.id WHERE qr.client_id=? ORDER BY q.created_at DESC`,[id]
    );
    res.json({success:true,client:clientRows[0],requests,quotes});
  } catch(error) {
    logError("Error obteniendo ficha compatible del cliente",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener la ficha del cliente."});
  }
});

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

      const [[clientsSummary]] = await pool.query(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN 1 ELSE 0 END) AS newClients
         FROM clients`,
        [days]
      );

      const [[gallerySummary]] = await pool.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) AS published,
                SUM(CASE WHEN featured=1 AND active=1 THEN 1 ELSE 0 END) AS featured
         FROM gallery`
      );

      const [[requestPipeline]] = await pool.query(
        `SELECT
          SUM(CASE WHEN status='pendiente' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status='en_revision' THEN 1 ELSE 0 END) AS review,
          SUM(CASE WHEN status='presupuestando' THEN 1 ELSE 0 END) AS quoting,
          SUM(CASE WHEN status='presupuestada' THEN 1 ELSE 0 END) AS quoted,
          SUM(CASE WHEN status='aceptada' THEN 1 ELSE 0 END) AS accepted
         FROM quote_requests`
      );

      const [upcomingJobs] = await pool.query(
        `SELECT j.id,j.status,j.scheduled_at,j.location,
                COALESCE(c.name,qr.name,'Sin cliente') AS client_name,
                u.name AS technician_name
         FROM jobs j
         LEFT JOIN clients c ON c.id=j.client_id
         LEFT JOIN quote_requests qr ON qr.id=j.quote_request_id
         LEFT JOIN users u ON u.id=j.assigned_user_id
         WHERE j.scheduled_at IS NOT NULL
           AND j.scheduled_at >= NOW()
           AND j.status IN ('aceptado','programado','en_proceso','pausado')
         ORDER BY j.scheduled_at ASC
         LIMIT 8`
      );

      const [topServices] = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(qr.service),''),'Sin servicio') AS service,
                COUNT(*) AS requests,
                SUM(CASE WHEN qr.status='aceptada' THEN 1 ELSE 0 END) AS accepted
         FROM quote_requests qr
         GROUP BY COALESCE(NULLIF(TRIM(qr.service),''),'Sin servicio')
         ORDER BY requests DESC, accepted DESC
         LIMIT 6`
      );

      const [jobStatusSummary] = await pool.query(
        `SELECT status,COUNT(*) AS total
         FROM jobs
         GROUP BY status
         ORDER BY total DESC`
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
        recentActivity,
        clients: {
          total: Number(clientsSummary.total || 0),
          newClients: Number(clientsSummary.newClients || 0)
        },
        gallery: {
          total: Number(gallerySummary.total || 0),
          published: Number(gallerySummary.published || 0),
          featured: Number(gallerySummary.featured || 0)
        },
        requestPipeline: {
          pending: Number(requestPipeline.pending || 0),
          review: Number(requestPipeline.review || 0),
          quoting: Number(requestPipeline.quoting || 0),
          quoted: Number(requestPipeline.quoted || 0),
          accepted: Number(requestPipeline.accepted || 0)
        },
        upcomingJobs: upcomingJobs.map(row => ({
          id: Number(row.id),
          status: row.status,
          scheduledAt: row.scheduled_at,
          location: row.location,
          clientName: row.client_name,
          technicianName: row.technician_name
        })),
        topServices: topServices.map(row => ({
          service: row.service,
          requests: Number(row.requests || 0),
          accepted: Number(row.accepted || 0)
        })),
        jobStatusSummary: jobStatusSummary.map(row => ({
          status: row.status,
          total: Number(row.total || 0)
        }))
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
// V2 — SESIONES ACTIVAS
// =========================================================

app.get("/api/account/sessions", requireAuth, async (req, res) => {
  try {
    await registerActiveSession(req, req.session.user.id);
    const [rows] = await pool.query(
      `SELECT id, ip_address, user_agent, created_at, last_seen_at,
              session_id = ? AS current_session
       FROM active_sessions
       WHERE user_id=?
       ORDER BY last_seen_at DESC`,
      [req.sessionID, req.session.user.id]
    );

    res.json({
      success: true,
      sessions: rows.map(row => ({
        id: row.id,
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        created_at: row.created_at,
        last_seen_at: row.last_seen_at,
        current: Boolean(row.current_session)
      }))
    });
  } catch (error) {
    logError("Error listando sesiones", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudieron obtener las sesiones." });
  }
});

app.delete("/api/account/sessions/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: "Sesión inválida." });

    const [rows] = await pool.query(
      "SELECT session_id, user_id FROM active_sessions WHERE id=? AND user_id=? LIMIT 1",
      [id, req.session.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: "Sesión no encontrada." });
    if (rows[0].session_id === req.sessionID) {
      return res.status(400).json({ success: false, error: "No podés cerrar la sesión actual desde este listado." });
    }

    await pool.query("DELETE FROM sessions WHERE session_id=?", [rows[0].session_id]);
    await pool.query("DELETE FROM active_sessions WHERE id=?", [id]);
    await writeAudit(req, "session_revoked", "session", id);
    res.json({ success: true, message: "Sesión cerrada correctamente." });
  } catch (error) {
    logError("Error revocando sesión", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo cerrar la sesión." });
  }
});

app.post("/api/account/sessions/revoke-others", requireAuth, async (req, res) => {
  try {
    await removeAllActiveSessions(req.session.user.id, req.sessionID);
    await pool.query(
      "DELETE FROM sessions WHERE session_id <> ? AND data LIKE ?",
      [req.sessionID, '%"user":{"id":' + Number(req.session.user.id) + ',%']
    );
    await writeAudit(req, "sessions_revoked_others", "user", req.session.user.id);
    res.json({ success: true, message: "Las demás sesiones fueron cerradas." });
  } catch (error) {
    logError("Error cerrando sesiones", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudieron cerrar las demás sesiones." });
  }
});

// =========================================================
// V2 — 2FA TOTP PARA ADMIN
// =========================================================

app.get("/api/account/2fa/status", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT role, totp_enabled FROM users WHERE id=? LIMIT 1", [req.session.user.id]);
    res.json({ success: true, enabled: Boolean(rows[0]?.totp_enabled), required: rows[0]?.role === "admin" });
  } catch (error) {
    res.status(500).json({ success: false, error: "No se pudo consultar 2FA." });
  }
});

app.post("/api/account/2fa/setup", requireAuth, authLimiter, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const [rows] = await pool.query("SELECT password_hash, role, totp_enabled FROM users WHERE id=? LIMIT 1", [req.session.user.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: "Usuario no encontrado." });
    if (rows[0].role !== "admin") return res.status(403).json({ success: false, error: "2FA está reservado para administradores." });
    if (rows[0].totp_enabled) return res.status(400).json({ success: false, error: "2FA ya está habilitado." });
    if (!await bcrypt.compare(currentPassword, rows[0].password_hash)) return res.status(401).json({ success: false, error: "La contraseña actual es incorrecta." });

    const secret = generateTotpSecret();
    const encrypted = encryptSecret(secret, process.env.SESSION_SECRET);
    await pool.query("UPDATE users SET totp_secret=? WHERE id=?", [encrypted, req.session.user.id]);

    const issuer = "JR Electricidad";
    const label = `${issuer}:${req.session.user.email}`;
    const otpauth = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    res.json({ success: true, secret, otpauth_uri: otpauth });
  } catch (error) {
    logError("Error preparando 2FA", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo preparar 2FA." });
  }
});

app.post("/api/account/2fa/enable", requireAuth, authLimiter, async (req, res) => {
  try {
    const code = String(req.body.code || "");
    const [rows] = await pool.query("SELECT totp_secret, totp_enabled, role FROM users WHERE id=? LIMIT 1", [req.session.user.id]);
    if (!rows.length || rows[0].role !== "admin") return res.status(403).json({ success: false, error: "Acceso no autorizado." });
    if (rows[0].totp_enabled) return res.status(400).json({ success: false, error: "2FA ya está habilitado." });
    if (!rows[0].totp_secret) return res.status(400).json({ success: false, error: "Primero generá la configuración de 2FA." });

    const secret = decryptSecret(rows[0].totp_secret, process.env.SESSION_SECRET);
    if (!verifyTotp(secret, code)) return res.status(401).json({ success: false, error: "Código 2FA inválido." });

    const backupCodes = generateBackupCodes();
    await pool.query("DELETE FROM mfa_backup_codes WHERE user_id=?", [req.session.user.id]);
    for (const backup of backupCodes) {
      await pool.query("INSERT INTO mfa_backup_codes (user_id, code_hash) VALUES (?, ?)", [req.session.user.id, hashBackupCode(backup)]);
    }
    await pool.query("UPDATE users SET totp_enabled=1 WHERE id=?", [req.session.user.id]);
    await writeAudit(req, "2fa_enabled", "user", req.session.user.id);

    res.json({ success: true, message: "2FA habilitado correctamente.", backup_codes: backupCodes });
  } catch (error) {
    logError("Error habilitando 2FA", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo habilitar 2FA." });
  }
});

app.post("/api/account/2fa/disable", requireAuth, authLimiter, async (req, res) => {
  try {
    const password = String(req.body.password || "");
    const code = String(req.body.code || "");
    const [rows] = await pool.query("SELECT password_hash, totp_secret, totp_enabled, role FROM users WHERE id=? LIMIT 1", [req.session.user.id]);
    if (!rows.length || rows[0].role !== "admin") return res.status(403).json({ success: false, error: "Acceso no autorizado." });
    if (!rows[0].totp_enabled) return res.status(400).json({ success: false, error: "2FA no está habilitado." });
    if (!await bcrypt.compare(password, rows[0].password_hash)) return res.status(401).json({ success: false, error: "La contraseña actual es incorrecta." });

    const secret = decryptSecret(rows[0].totp_secret, process.env.SESSION_SECRET);
    if (!verifyTotp(secret, code)) return res.status(401).json({ success: false, error: "Código 2FA inválido." });

    await pool.query("UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?", [req.session.user.id]);
    await pool.query("DELETE FROM mfa_backup_codes WHERE user_id=?", [req.session.user.id]);
    await writeAudit(req, "2fa_disabled", "user", req.session.user.id);
    res.json({ success: true, message: "2FA deshabilitado correctamente." });
  } catch (error) {
    logError("Error deshabilitando 2FA", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo deshabilitar 2FA." });
  }
});

app.post("/api/login/2fa", authLimiter, async (req, res) => {
  try {
    const pending = req.session.pending2fa;
    if (!pending || Date.now() - pending.createdAt > 5 * 60 * 1000) {
      return res.status(401).json({ success: false, error: "El desafío 2FA venció. Iniciá sesión nuevamente." });
    }

    const code = String(req.body.code || "").trim();
    const [rows] = await pool.query("SELECT id,name,email,role,totp_secret,totp_enabled FROM users WHERE id=? LIMIT 1", [pending.userId]);
    if (!rows.length || rows[0].role !== "admin" || !rows[0].totp_enabled) {
      return res.status(401).json({ success: false, error: "Desafío 2FA inválido." });
    }

    const secret = decryptSecret(rows[0].totp_secret, process.env.SESSION_SECRET);
    let valid = verifyTotp(secret, code);
    if (!valid && code) {
      const hash = hashBackupCode(code);
      const [codes] = await pool.query("SELECT id FROM mfa_backup_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL LIMIT 1", [pending.userId, hash]);
      if (codes.length) {
        await pool.query("UPDATE mfa_backup_codes SET used_at=NOW() WHERE id=?", [codes[0].id]);
        valid = true;
      }
    }

    if (!valid) {
      await writeAudit(req, "2fa_failed", "user", pending.userId);
      return res.status(401).json({ success: false, error: "Código 2FA inválido." });
    }

    const user = { id: rows[0].id, name: rows[0].name, email: rows[0].email, role: rows[0].role };
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.user = user;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    await registerActiveSession(req, user.id);
    await writeAudit(req, "login", "user", user.id, { mfa: true });
    res.json({ success: true, ok: true, user: cleanUser(user) });
  } catch (error) {
    logError("Error verificando 2FA", { requestId: req.requestId, error: error.message });
    res.status(500).json({ success: false, error: "No se pudo verificar 2FA." });
  }
});

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

  await pool.query(
    "DELETE FROM active_sessions WHERE last_seen_at < DATE_SUB(NOW(), INTERVAL 8 HOUR)"
  ).catch(error => {
    logError("No se pudieron limpiar sesiones activas vencidas", { error: error.message });
  });

  try {

    await pool.query(
      "SELECT 1"
    );


    console.log(
      "✅ MySQL conectado"
    );
	// =====================================================
// =====================================================
// FASE 8 — GESTIÓN AVANZADA DE TRABAJOS
// =====================================================

const JOB_STATUSES = [
  "pendiente_presupuesto",
  "presupuesto_enviado",
  "aceptado",
  "programado",
  "en_proceso",
  "pausado",
  "finalizado",
  "cerrado",
  "rechazado",
  "cancelado"
];

const JOB_TRANSITIONS = {
  pendiente_presupuesto:["presupuesto_enviado","rechazado","cancelado"],
  presupuesto_enviado:["aceptado","rechazado","cancelado"],
  aceptado:["programado","en_proceso","cancelado"],
  programado:["en_proceso","cancelado"],
  en_proceso:["pausado","finalizado","cancelado"],
  pausado:["en_proceso","cancelado"],
  finalizado:["cerrado"],
  cerrado:[],
  rechazado:[],
  cancelado:[]
};

const jobUpload = multer({
  storage,
  limits:{fileSize:10*1024*1024},
  fileFilter:(req,file,cb)=>{
    const allowed=[
      "image/jpeg","image/png","image/webp","image/gif",
      "application/pdf","text/plain",
      "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ];
    if(!allowed.includes(file.mimetype)) return cb(new Error("Tipo de archivo no permitido."));
    cb(null,true);
  }
});

function validateJobId(value){
  const id=Number(value);
  return Number.isInteger(id)&&id>0?id:null;
}

function validateJobStatus(value){
  const status=String(value||"").trim();
  return JOB_STATUSES.includes(status)?status:null;
}

function validateJobDateTime(value){
  if(value==null||String(value).trim()==="") return null;
  const text=String(value).trim();
  if(!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(text)) return undefined;
  return text.replace("T"," ");
}

async function recordJobHistory(req,jobId,action,oldStatus=null,newStatus=null,metadata=null,db=pool){
  await db.query(
    `INSERT INTO job_history
      (job_id,actor_user_id,action,old_status,new_status,metadata)
     VALUES (?,?,?,?,?,?)`,
    [jobId,req.session?.user?.id||null,action,oldStatus,newStatus,metadata?JSON.stringify(metadata):null]
  );
}

async function createJobNotification(type,quoteId,message,jobId,userId=null,priority="normal"){
  try {
    await createAdminNotification({
      type,
      quoteId,
      message,
      userId,
      entityType: "job",
      entityId: jobId,
      linkUrl: "/admin.html#jobsSection",
      priority
    });
  } catch(error) {
    logError("No se pudo crear notificación de trabajo",{error:error.message,quoteId,jobId,userId});
  }
}

// Lista de trabajos.
app.get("/api/admin/jobs",requireAdmin,async(req,res)=>{
  try{
    const search=String(req.query.search||"").trim();
    const status=String(req.query.status||"").trim();
    const assignedUserId=String(req.query.assigned_user_id||"").trim();
    const dateFrom=String(req.query.date_from||"").trim();
    const dateTo=String(req.query.date_to||"").trim();

    if(status&&!validateJobStatus(status)) return res.status(400).json({error:"Estado de trabajo inválido."});

    const params=[];
    let sql=`
      SELECT j.id,j.quote_id,j.status,j.started_at,j.completed_at,j.created_at,j.updated_at,
             j.assigned_user_id,j.scheduled_at,j.internal_notes,j.execution_notes,j.completion_notes,j.location,
             q.quote_number,q.issue_date,q.subtotal,q.discount,q.total,q.notes,
             qr.name AS client_name,qr.phone AS client_phone,qr.email AS client_email,
             qr.service AS requested_service,qr.description AS work_description,qr.preferred_date,
             u.name AS assigned_user_name
      FROM jobs j
      INNER JOIN quotes q ON q.id=j.quote_id
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN users u ON u.id=j.assigned_user_id
      WHERE 1=1`;

    if(search){
      const v=`%${search}%`;
      sql+=` AND (qr.name LIKE ? OR qr.phone LIKE ? OR qr.email LIKE ? OR q.quote_number LIKE ? OR qr.service LIKE ? OR qr.description LIKE ?)`;
      params.push(v,v,v,v,v,v);
    }
    if(status){sql+=" AND j.status=?";params.push(status);}
    if(assignedUserId){
      const id=Number(assignedUserId);
      if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:"Técnico inválido."});
      sql+=" AND j.assigned_user_id=?";params.push(id);
    }
    if(dateFrom){if(!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom))return res.status(400).json({error:"Fecha desde inválida."});sql+=" AND DATE(COALESCE(j.scheduled_at,j.created_at))>=?";params.push(dateFrom);}
    if(dateTo){if(!/^\d{4}-\d{2}-\d{2}$/.test(dateTo))return res.status(400).json({error:"Fecha hasta inválida."});sql+=" AND DATE(COALESCE(j.scheduled_at,j.created_at))<=?";params.push(dateTo);}
    sql+=" ORDER BY FIELD(j.status,'programado','en_proceso','pausado','finalizado','aceptado','pendiente_presupuesto','presupuesto_enviado','cerrado','rechazado','cancelado'),COALESCE(j.scheduled_at,j.created_at) ASC,j.id DESC";

    const [jobs]=await pool.query(sql,params);
    res.json({success:true,jobs});
  }catch(error){
    logError("Error obteniendo trabajos V2",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron obtener los trabajos."});
  }
});

// Detalle completo.
app.get("/api/admin/jobs/:id(\\d+)",requireAdmin,async(req,res)=>{
  try{
    const id=validateJobId(req.params.id);
    if(!id)return res.status(400).json({error:"ID de trabajo inválido."});
    const [rows]=await pool.query(`
      SELECT j.*,q.quote_number,q.issue_date,q.expiration_date,q.notes,q.subtotal,q.discount,q.total,
             qr.name AS client_name,qr.phone AS client_phone,qr.email AS client_email,
             qr.service AS requested_service,qr.description AS work_description,qr.preferred_date,
             c.address AS client_address,c.locality AS client_locality,u.name AS assigned_user_name
      FROM jobs j
      INNER JOIN quotes q ON q.id=j.quote_id
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN clients c ON c.id=qr.client_id
      LEFT JOIN users u ON u.id=j.assigned_user_id
      WHERE j.id=? LIMIT 1`,[id]);
    if(!rows.length)return res.status(404).json({error:"Trabajo no encontrado."});

    const [items]=await pool.query("SELECT id,description,quantity,unit,unit_price,total FROM quote_items WHERE quote_id=? ORDER BY id",[rows[0].quote_id]);
    const [history]=await pool.query(`
      SELECT h.*,u.name AS actor_name FROM job_history h
      LEFT JOIN users u ON u.id=h.actor_user_id
      WHERE h.job_id=? ORDER BY h.created_at DESC,h.id DESC`,[id]);
    const [attachments]=await pool.query(`
      SELECT id,original_name,url,mime_type,size_bytes,category,created_at
      FROM job_attachments WHERE job_id=? ORDER BY created_at DESC,id DESC`,[id]);

    res.json({success:true,job:{...rows[0],items,history,attachments}});
  }catch(error){
    logError("Error obteniendo detalle de trabajo",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el trabajo."});
  }
});

// Técnicos disponibles.
app.get("/api/admin/jobs/assignees",requireAdmin,async(req,res)=>{
  try{
    const [rows]=await pool.query("SELECT id,name,email FROM users ORDER BY name");
    res.json({success:true,users:rows});
  }catch(error){res.status(500).json({error:"No se pudieron obtener los técnicos."});}
});

// Actualizar datos operativos.
app.put("/api/admin/jobs/:id(\\d+)",requireAdmin,adminMutationLimiter,async(req,res)=>{
  try{
    const id=validateJobId(req.params.id);
    if(!id)return res.status(400).json({error:"ID de trabajo inválido."});
    const [rows]=await pool.query("SELECT * FROM jobs WHERE id=? LIMIT 1",[id]);
    if(!rows.length)return res.status(404).json({error:"Trabajo no encontrado."});
    const current=rows[0];
    if(["cerrado","cancelado","rechazado"].includes(current.status))return res.status(409).json({error:"Este trabajo ya está cerrado o cancelado."});

    let assigned=current.assigned_user_id;
    if(req.body.assigned_user_id!==undefined){
      assigned=req.body.assigned_user_id===""||req.body.assigned_user_id===null?null:Number(req.body.assigned_user_id);
      if(assigned!==null&&(!Number.isInteger(assigned)||assigned<=0))return res.status(400).json({error:"Técnico inválido."});
      if(assigned!==null){const [u]=await pool.query("SELECT id FROM users WHERE id=? LIMIT 1",[assigned]);if(!u.length)return res.status(400).json({error:"El técnico no existe."});}
    }
    const scheduled=req.body.scheduled_at===undefined?current.scheduled_at:validateJobDateTime(req.body.scheduled_at);
    if(scheduled===undefined)return res.status(400).json({error:"Fecha programada inválida."});
    const fields={
      assigned_user_id:assigned,
      scheduled_at:scheduled,
      internal_notes:req.body.internal_notes===undefined?current.internal_notes:String(req.body.internal_notes||"").slice(0,10000),
      execution_notes:req.body.execution_notes===undefined?current.execution_notes:String(req.body.execution_notes||"").slice(0,10000),
      location:req.body.location===undefined?current.location:String(req.body.location||"").slice(0,255)
    };
    await pool.query(`UPDATE jobs SET assigned_user_id=?,scheduled_at=?,internal_notes=?,execution_notes=?,location=? WHERE id=?`,
      [fields.assigned_user_id,fields.scheduled_at,fields.internal_notes,fields.execution_notes,fields.location,id]);
    await recordJobHistory(req,id,"job_updated",current.status,current.status,{changes:fields});
    await writeAudit(req,"job_updated","job",id,fields);

    if (String(current.assigned_user_id || "") !== String(fields.assigned_user_id || "")) {
      if (fields.assigned_user_id) {
        await createJobNotification(
          "job_assigned",
          current.quote_id,
          `El trabajo #${id} fue asignado a tu usuario.`,
          id,
          fields.assigned_user_id,
          "high"
        );
      } else {
        await createJobNotification(
          "job_status_changed",
          current.quote_id,
          `El trabajo #${id} quedó sin técnico asignado.`,
          id,
          null,
          "normal"
        );
      }
    }

    if (String(current.scheduled_at || "") !== String(fields.scheduled_at || "") && fields.scheduled_at) {
      await createJobNotification(
        "job_scheduled",
        current.quote_id,
        `El trabajo #${id} fue programado para ${new Date(fields.scheduled_at).toLocaleString("es-AR")}.`,
        id,
        fields.assigned_user_id || null,
        "high"
      );
    }
      await notifyJobCustomer(id, current.status, fields.scheduled_at);
      await notifyJobWhatsApp(id, current.status, fields.scheduled_at);

    res.json({success:true,message:"Trabajo actualizado correctamente."});
  }catch(error){
    logError("Error actualizando trabajo",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el trabajo."});
  }
});

// Cambiar estado con transiciones controladas.
app.put("/api/admin/jobs/:id(\\d+)/status",requireAdmin,adminMutationLimiter,async(req,res)=>{
  const connection=await pool.getConnection();
  try{
    const id=validateJobId(req.params.id);
    const next=validateJobStatus(req.body?.status);
    if(!id||!next){connection.release();return res.status(400).json({error:"ID o estado de trabajo inválido."});}
    const [rows]=await connection.query("SELECT * FROM jobs WHERE id=? LIMIT 1 FOR UPDATE",[id]);
    if(!rows.length){connection.release();return res.status(404).json({error:"Trabajo no encontrado."});}
    const job=rows[0];
    if(job.status===next){connection.release();return res.json({success:true,status:next,message:"El trabajo ya se encuentra en ese estado."});}
    if(!(JOB_TRANSITIONS[job.status]||[]).includes(next)){
      connection.release();return res.status(409).json({error:"No se puede cambiar a ese estado desde el estado actual."});
    }

    const nowFields=[];
    const values=[];
    if(next==="en_proceso"){
      nowFields.push("started_at=COALESCE(started_at,NOW())","started_by_user_id=?");values.push(req.session.user.id);
    }
    if(next==="finalizado"){
      nowFields.push("completed_at=COALESCE(completed_at,NOW())","completed_by_user_id=?");values.push(req.session.user.id);
    }
    if(next==="cerrado" && !job.completed_at){
      nowFields.push("completed_at=NOW()","completed_by_user_id=?");values.push(req.session.user.id);
    }
    nowFields.push("status=?");values.push(next,id);
    await connection.query(`UPDATE jobs SET ${nowFields.join(",")} WHERE id=?`,values);
    await recordJobHistory(req,id,"status_changed",job.status,next,null,connection);
    await connection.commit();

    const messages={
      programado:"Trabajo programado correctamente.",
      en_proceso:"Trabajo iniciado correctamente.",
      pausado:"Trabajo pausado correctamente.",
      finalizado:"Trabajo marcado como finalizado.",
      cerrado:"Trabajo cerrado correctamente.",
      cancelado:"Trabajo cancelado correctamente."
    };
    const notificationType =
      next === "cerrado" ? "job_closed" :
      next === "finalizado" ? "job_finished" :
      next === "en_proceso" ? "job_started" :
      "job_status_changed";
    const notificationPriority =
      ["finalizado","cerrado","en_proceso"].includes(next) ? "high" :
      ["programado","pausado"].includes(next) ? "normal" : "low";
    await createJobNotification(
      notificationType,
      job.quote_id,
      `El trabajo #${id} pasó de ${job.status} a ${next}.`,
      id,
      job.assigned_user_id || null,
      notificationPriority
    );
    await notifyJobCustomer(id, next, next === "programado" ? job.scheduled_at : null);
    await notifyJobWhatsApp(id, next, next === "programado" ? job.scheduled_at : null);
    await writeAudit(req,"job_status_changed","job",id,{old_status:job.status,new_status:next});
    res.json({success:true,status:next,message:messages[next]||"Estado actualizado correctamente."});
  }catch(error){
    await connection.rollback().catch(()=>{});
    logError("Error actualizando estado de trabajo",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el estado del trabajo."});
  }finally{connection.release();}
});

// Historial.
app.get("/api/admin/jobs/:id(\\d+)/history",requireAdmin,async(req,res)=>{
  try{
    const id=validateJobId(req.params.id);if(!id)return res.status(400).json({error:"ID inválido."});
    const [rows]=await pool.query(`
      SELECT h.*,u.name AS actor_name FROM job_history h
      LEFT JOIN users u ON u.id=h.actor_user_id
      WHERE h.job_id=? ORDER BY h.created_at DESC,h.id DESC`,[id]);
    res.json({success:true,history:rows});
  }catch(error){res.status(500).json({error:"No se pudo obtener el historial."});}
});

// Subir evidencia/documento.
app.post("/api/admin/jobs/:id(\\d+)/attachments",requireAdmin,jobUpload.single("file"),async(req,res)=>{
  try{
    const id=validateJobId(req.params.id);if(!id)return res.status(400).json({error:"ID inválido."});
    const [rows]=await pool.query("SELECT id FROM jobs WHERE id=? LIMIT 1",[id]);
    if(!rows.length){if(req.file)fs.unlink(req.file.path,()=>{});return res.status(404).json({error:"Trabajo no encontrado."});}
    if(!req.file)return res.status(400).json({error:"No se recibió ningún archivo."});
    const allowedCategories=["inicio","proceso","final","documento","otro"];
    const category=allowedCategories.includes(String(req.body.category||""))?String(req.body.category):"otro";
    const url="/uploads/"+req.file.filename;
    const [result]=await pool.query(`
      INSERT INTO job_attachments
      (job_id,uploaded_by_user_id,original_name,stored_name,url,mime_type,size_bytes,category)
      VALUES (?,?,?,?,?,?,?,?)`,
      [id,req.session.user.id,req.file.originalname,req.file.filename,url,req.file.mimetype,req.file.size,category]
    );
    await recordJobHistory(req,id,"attachment_added",null,null,{attachment_id:result.insertId,category,name:req.file.originalname});
    await writeAudit(req,"job_attachment_added","job",id,{attachment_id:result.insertId,category});
    res.status(201).json({success:true,id:result.insertId,url,message:"Archivo adjuntado correctamente."});
  }catch(error){
    if(req.file)fs.unlink(req.file.path,()=>{});
    logError("Error subiendo evidencia de trabajo",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo adjuntar el archivo."});
  }
});

// Eliminar evidencia.
app.delete("/api/admin/jobs/:id(\\d+)/attachments/:attachmentId(\\d+)",requireAdmin,adminMutationLimiter,async(req,res)=>{
  try{
    const jobId=validateJobId(req.params.id),attachmentId=validateJobId(req.params.attachmentId);
    if(!jobId||!attachmentId)return res.status(400).json({error:"ID inválido."});
    const [rows]=await pool.query("SELECT * FROM job_attachments WHERE id=? AND job_id=? LIMIT 1",[attachmentId,jobId]);
    if(!rows.length)return res.status(404).json({error:"Archivo no encontrado."});
    const [[publishedGallery]]=await pool.query(
      "SELECT id FROM gallery WHERE source_job_attachment_id=? LIMIT 1",
      [attachmentId]
    );
    if(publishedGallery){
      return res.status(409).json({
        error:"Esta evidencia está publicada en la galería. Eliminá primero la publicación de galería."
      });
    }
    await pool.query("DELETE FROM job_attachments WHERE id=?",[attachmentId]);
    if(rows[0].stored_name)fs.unlink(path.join(uploadsDir,rows[0].stored_name),()=>{});
    await recordJobHistory(req,jobId,"attachment_deleted",null,null,{attachment_id:attachmentId});
    await writeAudit(req,"job_attachment_deleted","job",jobId,{attachment_id:attachmentId});
    res.json({success:true,message:"Archivo eliminado."});
  }catch(error){res.status(500).json({error:"No se pudo eliminar el archivo."});}
});

// Historial cerrado con filtros.
app.get("/api/admin/jobs-history",requireAdmin,async(req,res)=>{
  try{
    const search=String(req.query.search||"").trim();
    const dateFrom=String(req.query.date_from||"").trim();
    const dateTo=String(req.query.date_to||"").trim();
    const params=[];
    let sql=`
      SELECT j.id,j.quote_id,j.status,j.started_at,j.completed_at,j.created_at,j.updated_at,
             j.scheduled_at,j.location,j.assigned_user_id,u.name AS assigned_user_name,
             q.quote_number,q.issue_date,q.subtotal,q.discount,q.total,q.notes,
             qr.name AS client_name,qr.phone AS client_phone,qr.email AS client_email,
             qr.service AS requested_service,qr.description AS work_description
      FROM jobs j
      INNER JOIN quotes q ON q.id=j.quote_id
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN users u ON u.id=j.assigned_user_id
      WHERE j.status IN ('cerrado','finalizado')`;
    if(search){const v=`%${search}%`;sql+=" AND (qr.name LIKE ? OR qr.phone LIKE ? OR qr.email LIKE ? OR q.quote_number LIKE ? OR qr.service LIKE ? OR qr.description LIKE ?)";params.push(v,v,v,v,v,v);}
    if(dateFrom){if(!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom))return res.status(400).json({error:"Fecha desde inválida."});sql+=" AND DATE(COALESCE(j.completed_at,j.created_at))>=?";params.push(dateFrom);}
    if(dateTo){if(!/^\d{4}-\d{2}-\d{2}$/.test(dateTo))return res.status(400).json({error:"Fecha hasta inválida."});sql+=" AND DATE(COALESCE(j.completed_at,j.created_at))<=?";params.push(dateTo);}
    sql+=" ORDER BY COALESCE(j.completed_at,j.created_at) DESC,j.id DESC";
    const [jobs]=await pool.query(sql,params);
    res.json({success:true,jobs,summary:{count:jobs.length,total:jobs.reduce((sum,row)=>sum+Number(row.total||0),0)}});
  }catch(error){logError("Error obteniendo historial de trabajos",{requestId:req.requestId,error:error.message});res.status(500).json({error:"No se pudo obtener el historial."});}
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
// SOLICITUDES - ADMIN V2
// ========================================

const REQUEST_STATUSES = [
  "nueva",
  "en_revision",
  "presupuestando",
  "presupuestada",
  "aceptada",
  "programada",
  "en_trabajo",
  "finalizada",
  "cerrada"
];

const REQUEST_PRIORITIES = [
  "baja",
  "normal",
  "alta",
  "urgente"
];

function validateRequestId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateRequestStatus(status) {
  return REQUEST_STATUSES.includes(String(status || "").trim());
}

function validateRequestPriority(priority) {
  return REQUEST_PRIORITIES.includes(String(priority || "").trim());
}

function validateOptionalDateTime(value) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text) &&
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text)) {
    return undefined;
  }
  return text.replace("T", " ");
}

async function recordRequestHistory(req, requestId, action, oldStatus, newStatus, metadata = null) {
  await pool.query(
    `INSERT INTO quote_request_history
      (quote_request_id, actor_user_id, action, old_status, new_status, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      requestId,
      req.session?.user?.id || null,
      action,
      oldStatus || null,
      newStatus || null,
      metadata ? JSON.stringify(metadata) : null
    ]
  );
}

async function notifyRequestWhatsApp(request, message, entityType="quote_request") {
  try {
    const settings=await whatsappBusinessEnabled();
    if(!settings?.whatsapp_auto_notifications || !request?.whatsapp && !request?.phone) return false;
    const phone=request.whatsapp || request.phone;
    await queueWhatsApp({
      to:phone,
      message,
      requestId:null,
      entityType,
      entityId:request.id
    });
    return true;
  } catch(error) {
    logError("No se pudo encolar WhatsApp de cliente",{requestId:null,error:error.message,entityId:request?.id});
    return false;
  }
}

async function notifyRequestCustomer(request, subject, message) {
  if (!request?.email) return false;
  try {
    const template = String(subject || "").toLowerCase().includes("recibida")
      ? "request_received"
      : "request_status";
    await queueEmail({
      to: request.email,
      subject,
      template,
      data: {
        name: request.name,
        requestId: request.id,
        status: request.status,
        service: request.service,
        message
      },
      requestId: null
    });
    return true;
  } catch (error) {
    logError("No se pudo encolar notificación al cliente", {
      requestId: null,
      error: error.message,
      quoteRequestId: request.id
    });
    return false;
  }
}

async function notifyJobWhatsApp(jobId, status, scheduledAt = null) {
  try {
    const settings=await whatsappBusinessEnabled();
    if(!settings?.whatsapp_auto_notifications) return false;
    const [rows]=await pool.query(
      `SELECT j.id,qr.phone,qr.whatsapp,qr.name
       FROM jobs j
       INNER JOIN quotes q ON q.id=j.quote_id
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE j.id=? LIMIT 1`,[jobId]
    );
    const job=rows[0];
    const phone=job?.whatsapp || job?.phone;
    if(!phone) return false;
    let message=`JR Electricidad: el trabajo #${jobId} está en estado ${String(status).replace(/_/g," ")}.`;
    if(scheduledAt) message+=` Programado para ${new Date(scheduledAt).toLocaleString("es-AR").replace(",", "")}.`;
    await queueWhatsApp({to:phone,message,entityType:"job",entityId:jobId});
    return true;
  } catch(error) {
    logError("No se pudo encolar WhatsApp del trabajo",{requestId:null,error:error.message,jobId});
    return false;
  }
}

async function notifyJobCustomer(jobId, status, scheduledAt = null) {
  try {
    const [rows] = await pool.query(
      `SELECT j.id,j.status,qr.name,qr.email
       FROM jobs j
       INNER JOIN quotes q ON q.id=j.quote_id
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE j.id=? LIMIT 1`,
      [jobId]
    );
    const job=rows[0];
    if(!job?.email) return false;
    await queueEmail({
      to: job.email,
      subject: "Actualización de trabajo #" + jobId + " - JR Electricidad",
      template: "job_update",
      data: {
        name: job.name,
        jobId,
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toLocaleString("es-AR") : null
      }
    });
    return true;
  } catch(error) {
    logError("No se pudo encolar actualización del trabajo al cliente", {
      requestId:null,
      jobId,
      error:error.message
    });
    return false;
  }
}

// Listar solicitudes con búsqueda, estado, prioridad, técnico y fechas.
app.get("/api/admin/quote-requests", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const priority = String(req.query.priority || "").trim();
    const assignedUserId = String(req.query.assigned_user_id || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    if (status && !validateRequestStatus(status)) {
      return res.status(400).json({ error: "Estado de solicitud inválido." });
    }
    if (priority && !validateRequestPriority(priority)) {
      return res.status(400).json({ error: "Prioridad inválida." });
    }

    const params = [];
    let sql = `
      SELECT
        qr.id, qr.client_id, qr.name, qr.phone, qr.email, qr.service,
        qr.description, qr.preferred_date, qr.image_url, qr.status,
        qr.priority, qr.assigned_user_id, qr.scheduled_at,
        qr.internal_notes, qr.closed_at, qr.created_at, qr.updated_at,
        u.name AS assigned_user_name,
        c.locality AS client_locality,
        (SELECT COUNT(*) FROM quote_request_attachments a WHERE a.quote_request_id=qr.id) AS attachments_count,
        (SELECT COUNT(*) FROM quote_request_history h WHERE h.quote_request_id=qr.id) AS history_count,
        q.id AS quote_id,
        q.quote_number,
        j.id AS job_id,
        j.status AS job_status
      FROM quote_requests qr
      LEFT JOIN users u ON u.id=qr.assigned_user_id
      LEFT JOIN clients c ON c.id=qr.client_id
      LEFT JOIN quotes q ON q.quote_request_id=qr.id
      LEFT JOIN jobs j ON j.quote_id=q.id
      WHERE 1=1
    `;

    if (search) {
      const value = `%${search}%`;
      sql += ` AND (
        qr.name LIKE ? OR qr.phone LIKE ? OR qr.email LIKE ? OR
        qr.service LIKE ? OR qr.description LIKE ? OR c.locality LIKE ?
      )`;
      params.push(value, value, value, value, value, value);
    }

    if (status) {
      sql += " AND qr.status=?";
      params.push(status);
    }

    if (priority) {
      sql += " AND qr.priority=?";
      params.push(priority);
    }

    if (assignedUserId) {
      const id = Number(assignedUserId);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Técnico asignado inválido." });
      }
      sql += " AND qr.assigned_user_id=?";
      params.push(id);
    }

    if (dateFrom) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
        return res.status(400).json({ error: "La fecha desde no es válida." });
      }
      sql += " AND DATE(qr.created_at)>=?";
      params.push(dateFrom);
    }

    if (dateTo) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
        return res.status(400).json({ error: "La fecha hasta no es válida." });
      }
      sql += " AND DATE(qr.created_at)<=?";
      params.push(dateTo);
    }

    sql += " ORDER BY FIELD(qr.priority,'urgente','alta','normal','baja'), qr.created_at DESC, qr.id DESC";

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo solicitudes V2", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener las solicitudes." });
  }
});

// Obtener una solicitud completa.
app.get("/api/admin/quote-requests/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID de solicitud inválido." });

    const [rows] = await pool.query(
      `SELECT
        qr.*,
        u.name AS assigned_user_name,
        c.locality AS client_locality,
        c.address AS client_address,
        q.id AS quote_id,
        q.quote_number,
        j.id AS job_id,
        j.status AS job_status
       FROM quote_requests qr
       LEFT JOIN users u ON u.id=qr.assigned_user_id
       LEFT JOIN clients c ON c.id=qr.client_id
       LEFT JOIN quotes q ON q.quote_request_id=qr.id
       LEFT JOIN jobs j ON j.quote_id=q.id
       WHERE qr.id=? LIMIT 1`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: "Solicitud no encontrada." });

    const [history] = await pool.query(
      `SELECT h.*, u.name AS actor_name
       FROM quote_request_history h
       LEFT JOIN users u ON u.id=h.actor_user_id
       WHERE h.quote_request_id=?
       ORDER BY h.created_at DESC, h.id DESC`,
      [id]
    );

    const [attachments] = await pool.query(
      `SELECT id, original_name, url, mime_type, size_bytes, created_at
       FROM quote_request_attachments
       WHERE quote_request_id=?
       ORDER BY created_at DESC, id DESC`,
      [id]
    );

    res.json({
      ...rows[0],
      history,
      attachments
    });
  } catch (error) {
    logError("Error obteniendo detalle de solicitud", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo obtener la solicitud." });
  }
});

// Actualizar estado/prioridad/técnico/agenda/notas.
app.patch("/api/admin/quote-requests/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = validateRequestId(req.params.id);
    if (!id) {
      connection.release();
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    const [existingRows] = await connection.query(
      "SELECT * FROM quote_requests WHERE id=? LIMIT 1 FOR UPDATE",
      [id]
    );

    if (!existingRows.length) {
      connection.release();
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const current = existingRows[0];
    const body = req.body || {};

    let status = body.status === undefined ? current.status : String(body.status || "").trim();
    let priority = body.priority === undefined ? current.priority : String(body.priority || "").trim();

    if (!validateRequestStatus(status)) {
      connection.release();
      return res.status(400).json({ error: "Estado de solicitud inválido." });
    }

    if (!validateRequestPriority(priority)) {
      connection.release();
      return res.status(400).json({ error: "Prioridad inválida." });
    }

    let assignedUserId = current.assigned_user_id;
    if (body.assigned_user_id !== undefined && body.assigned_user_id !== null && String(body.assigned_user_id).trim() !== "") {
      assignedUserId = Number(body.assigned_user_id);
      if (!Number.isInteger(assignedUserId) || assignedUserId <= 0) {
        connection.release();
        return res.status(400).json({ error: "Técnico asignado inválido." });
      }
      const [userRows] = await connection.query("SELECT id FROM users WHERE id=? LIMIT 1", [assignedUserId]);
      if (!userRows.length) {
        connection.release();
        return res.status(400).json({ error: "El técnico asignado no existe." });
      }
    } else if (body.assigned_user_id === null || String(body.assigned_user_id || "").trim() === "") {
      assignedUserId = null;
    }

    const scheduledAt = body.scheduled_at === undefined
      ? current.scheduled_at
      : validateOptionalDateTime(body.scheduled_at);

    if (scheduledAt === undefined) {
      connection.release();
      return res.status(400).json({ error: "La fecha programada no es válida." });
    }

    const internalNotes = body.internal_notes === undefined
      ? String(current.internal_notes || "")
      : String(body.internal_notes || "").trim();

    if (internalNotes.length > 10000) {
      connection.release();
      return res.status(400).json({ error: "Las notas internas no pueden superar 10000 caracteres." });
    }

    const closedAt = status === "cerrada" || status === "finalizada"
      ? (current.closed_at || new Date())
      : null;

    await connection.beginTransaction();

    await connection.query(
      `UPDATE quote_requests
       SET status=?, priority=?, assigned_user_id=?, scheduled_at=?, internal_notes=?, closed_at=?
       WHERE id=?`,
      [status, priority, assignedUserId, scheduledAt, internalNotes || null, closedAt, id]
    );

    if (
      String(current.status) !== status ||
      String(current.priority || "normal") !== priority ||
      Number(current.assigned_user_id || 0) !== Number(assignedUserId || 0) ||
      String(current.scheduled_at || "") !== String(scheduledAt || "") ||
      String(current.internal_notes || "") !== internalNotes
    ) {
      await connection.query(
        `INSERT INTO quote_request_history
          (quote_request_id, actor_user_id, action, old_status, new_status, metadata)
         VALUES (?, ?, 'request_updated', ?, ?, ?)`,
        [
          id,
          req.session.user.id,
          current.status,
          status,
          JSON.stringify({
            priority,
            assigned_user_id: assignedUserId,
            scheduled_at: scheduledAt,
            internal_notes_changed: String(current.internal_notes || "") !== internalNotes
          })
        ]
      );
    }

    await connection.commit();
    connection.release();

    await writeAudit(req, "request_updated", "quote_request", id, {
      status,
      priority,
      assigned_user_id: assignedUserId,
      scheduled_at: scheduledAt
    });

    if (String(current.status) !== status) {
      await createAdminNotification({
        type: "quote_request_status",
        message: `La solicitud #${id} cambió de "${current.status}" a "${status}".`,
        entityType: "quote_request",
        entityId: id,
        linkUrl: "/admin.html#quoteRequestsSection",
        priority: ["urgente","alta"].includes(String(priority)) ? "high" : "normal"
      }).catch(() => {});

      const [requestRows] = await pool.query(
        "SELECT id,name,email,phone,whatsapp,service,status FROM quote_requests WHERE id=? LIMIT 1",
        [id]
      );
      if (requestRows.length) {
        await notifyRequestCustomer(
          requestRows[0],
          `Actualización de tu solicitud #${id} - JR Electricidad`,
          `El estado de tu solicitud cambió a: ${status.replace(/_/g, " ")}.`
        );
        await notifyRequestWhatsApp(
          requestRows[0],
          `JR Electricidad: tu solicitud #${id} cambió a ${status.replace(/_/g, " ")}.`
        );
      }
    }

    res.json({ success: true, message: "Solicitud actualizada correctamente." });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error actualizando solicitud V2", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo actualizar la solicitud." });
  }
});

// Compatibilidad V1 para cambio de estado.
app.patch("/api/admin/quote-requests/:id(\\d+)/status", requireAdmin, adminMutationLimiter, async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    const statusMap = {
      pendiente: "nueva",
      contactado: "en_revision",
      presupuestado: "presupuestada",
      cerrado: "cerrada"
    };
    const incoming = String(req.body.status || "").trim();
    const status = statusMap[incoming] || incoming;

    if (!id || !validateRequestStatus(status)) {
      return res.status(400).json({ error: "Estado de solicitud inválido." });
    }

    const [currentRows] = await pool.query("SELECT status FROM quote_requests WHERE id=? LIMIT 1", [id]);
    if (!currentRows.length) return res.status(404).json({ error: "Solicitud no encontrada." });

    await pool.query("UPDATE quote_requests SET status=?, closed_at=? WHERE id=?",
      [status, status === "cerrada" ? new Date() : null, id]);

    await pool.query(
      `INSERT INTO quote_request_history
        (quote_request_id, actor_user_id, action, old_status, new_status)
       VALUES (?, ?, 'status_changed', ?, ?)`,
      [id, req.session.user.id, currentRows[0].status, status]
    );

    await writeAudit(req, "request_status_changed", "quote_request", id, {
      old_status: currentRows[0].status,
      new_status: status
    });

    await createAdminNotification({
      type: "quote_request_status",
      message: `La solicitud #${id} cambió al estado "${status}".`,
      entityType: "quote_request",
      entityId: id,
      linkUrl: "/admin.html#quoteRequestsSection",
      priority: "normal"
    }).catch(() => {});

    res.json({ success: true, message: "Estado de la solicitud actualizado.", status });
  } catch (error) {
    logError("Error actualizando estado de solicitud", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo actualizar el estado." });
  }
});

// Historial independiente.
app.get("/api/admin/quote-requests/:id(\\d+)/history", requireAdmin, async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID de solicitud inválido." });

    const [rows] = await pool.query(
      `SELECT h.id,h.action,h.old_status,h.new_status,h.metadata,h.created_at,u.name AS actor_name
       FROM quote_request_history h
       LEFT JOIN users u ON u.id=h.actor_user_id
       WHERE h.quote_request_id=?
       ORDER BY h.created_at DESC,h.id DESC`,
      [id]
    );
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo historial de solicitud", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo obtener el historial." });
  }
});

// Técnicos disponibles.
app.get("/api/admin/quote-requests/assignees", requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id,name,email,role FROM users ORDER BY name ASC"
    );
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo técnicos", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener los técnicos." });
  }
});

// Adjuntar imágenes/documentos.
const requestAttachmentsDir = path.join(uploadsDir, "requests");
if (!fs.existsSync(requestAttachmentsDir)) fs.mkdirSync(requestAttachmentsDir, { recursive: true });

const requestAttachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, requestAttachmentsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, Date.now() + "-" + crypto.randomBytes(10).toString("hex") + ext);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain"
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Tipo de archivo no permitido."));
    }
    cb(null, true);
  }
});

app.post("/api/admin/quote-requests/:id(\\d+)/attachments", requireAdmin, requestAttachmentUpload.single("file"), async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    if (!id) {
      if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    if (!req.file) return res.status(400).json({ error: "Seleccioná un archivo." });

    const [rows] = await pool.query("SELECT id FROM quote_requests WHERE id=? LIMIT 1", [id]);
    if (!rows.length) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const url = "/uploads/requests/" + req.file.filename;

    const [result] = await pool.query(
      `INSERT INTO quote_request_attachments
        (quote_request_id, uploaded_by_user_id, original_name, stored_name, url, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.session.user.id,
        String(req.file.originalname || "").slice(0, 255),
        req.file.filename,
        url,
        req.file.mimetype,
        Number(req.file.size || 0)
      ]
    );

    await recordRequestHistory(req, id, "attachment_added", null, null, {
      attachment_id: result.insertId,
      original_name: req.file.originalname
    });

    await writeAudit(req, "request_attachment_added", "quote_request", id, {
      attachment_id: result.insertId,
      original_name: req.file.originalname
    });

    res.status(201).json({
      success: true,
      attachment: {
        id: result.insertId,
        original_name: req.file.originalname,
        url,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size
      }
    });
  } catch (error) {
    if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
    logError("Error adjuntando archivo a solicitud", { requestId: req.requestId, error: error.message });
    res.status(400).json({ error: error.message || "No se pudo adjuntar el archivo." });
  }
});

app.delete("/api/admin/quote-requests/:id(\\d+)/attachments/:attachmentId(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = validateRequestId(req.params.id);
    const attachmentId = validateRequestId(req.params.attachmentId);
    if (!id || !attachmentId) return res.status(400).json({ error: "ID de solicitud o archivo inválido." });

    const [rows] = await pool.query(
      "SELECT * FROM quote_request_attachments WHERE id=? AND quote_request_id=? LIMIT 1",
      [attachmentId, id]
    );
    if (!rows.length) return res.status(404).json({ error: "Archivo no encontrado." });

    const filePath = path.join(requestAttachmentsDir, rows[0].stored_name);
    await fs.promises.unlink(filePath).catch(() => {});
    await pool.query("DELETE FROM quote_request_attachments WHERE id=?", [attachmentId]);

    await recordRequestHistory(req, id, "attachment_deleted", null, null, {
      attachment_id: attachmentId,
      original_name: rows[0].original_name
    });

    await writeAudit(req, "request_attachment_deleted", "quote_request", id, {
      attachment_id: attachmentId
    });

    res.json({ success: true, message: "Archivo eliminado." });
  } catch (error) {
    logError("Error eliminando archivo de solicitud", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo eliminar el archivo." });
  }
});

// Convertir solicitud a presupuesto borrador.
app.post("/api/admin/quote-requests/:id(\\d+)/convert-to-quote", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = validateRequestId(req.params.id);
    if (!id) {
      connection.release();
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    await connection.beginTransaction();

    const [requestRows] = await connection.query(
      "SELECT * FROM quote_requests WHERE id=? LIMIT 1 FOR UPDATE",
      [id]
    );
    if (!requestRows.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const request = requestRows[0];

    const [existingQuotes] = await connection.query(
      "SELECT id,quote_number,status FROM quotes WHERE quote_request_id=? ORDER BY id DESC LIMIT 1",
      [id]
    );

    if (existingQuotes.length) {
      await connection.commit();
      connection.release();
      return res.json({
        success: true,
        already_exists: true,
        quote_id: existingQuotes[0].id,
        quote_number: existingQuotes[0].quote_number,
        status: existingQuotes[0].status
      });
    }

    const quoteNumber = `PR-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${id}`;
    const accessToken = crypto.randomBytes(24).toString("hex");

    const [quoteResult] = await connection.query(
      `INSERT INTO quotes
        (quote_request_id, quote_number, access_token, issue_date, expiration_date, notes, status, subtotal, discount, total)
       VALUES (?, ?, ?, CURDATE(), NULL, ?, 'borrador', 0, 0, 0)`,
      [id, quoteNumber, accessToken, request.internal_notes || request.description || ""]
    );

    await connection.query(
      `INSERT INTO quote_items
        (quote_id, description, quantity, unit, unit_price, total)
       VALUES (?, ?, 1, 'global', 0, 0)`,
      [quoteResult.insertId, request.service || request.description || "Trabajo solicitado"]
    );

    const newStatus = request.status === "nueva" || request.status === "en_revision" || request.status === "presupuestando"
      ? "presupuestada"
      : request.status;

    await connection.query(
      "UPDATE quote_requests SET status=? WHERE id=?",
      [newStatus, id]
    );

    await connection.query(
      `INSERT INTO quote_request_history
        (quote_request_id, actor_user_id, action, old_status, new_status, metadata)
       VALUES (?, ?, 'converted_to_quote', ?, ?, ?)`,
      [id, req.session.user.id, request.status, newStatus, JSON.stringify({ quote_id: quoteResult.insertId })]
    );

    await connection.commit();
    connection.release();

    await writeAudit(req, "request_converted_to_quote", "quote_request", id, {
      quote_id: quoteResult.insertId
    });

    res.status(201).json({
      success: true,
      quote_id: quoteResult.insertId,
      quote_number: quoteNumber,
      status: "borrador"
    });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error convirtiendo solicitud a presupuesto", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo convertir la solicitud en presupuesto." });
  }
});

// Convertir solicitud a trabajo. Si no existe presupuesto, crea uno borrador primero.
app.post("/api/admin/quote-requests/:id(\\d+)/convert-to-job", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = validateRequestId(req.params.id);
    if (!id) {
      connection.release();
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    await connection.beginTransaction();

    const [requestRows] = await connection.query(
      "SELECT * FROM quote_requests WHERE id=? LIMIT 1 FOR UPDATE",
      [id]
    );
    if (!requestRows.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const request = requestRows[0];

    const [quoteRows] = await connection.query(
      "SELECT id,quote_number FROM quotes WHERE quote_request_id=? ORDER BY id DESC LIMIT 1",
      [id]
    );

    let quoteId;
    let quoteNumber;

    if (quoteRows.length) {
      quoteId = quoteRows[0].id;
      quoteNumber = quoteRows[0].quote_number;
    } else {
      quoteNumber = `PR-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${id}`;
      const accessToken = crypto.randomBytes(24).toString("hex");

      const [quoteResult] = await connection.query(
        `INSERT INTO quotes
          (quote_request_id, quote_number, access_token, issue_date, expiration_date, notes, status, subtotal, discount, total)
         VALUES (?, ?, ?, CURDATE(), NULL, ?, 'borrador', 0, 0, 0)`,
        [id, quoteNumber, accessToken, request.internal_notes || request.description || ""]
      );

      quoteId = quoteResult.insertId;

      await connection.query(
        `INSERT INTO quote_items
          (quote_id, description, quantity, unit, unit_price, total)
         VALUES (?, ?, 1, 'global', 0, 0)`,
        [quoteId, request.service || request.description || "Trabajo solicitado"]
      );
    }

    const [jobRows] = await connection.query(
      "SELECT id,status FROM jobs WHERE quote_id=? LIMIT 1",
      [quoteId]
    );

    if (jobRows.length) {
      await connection.commit();
      connection.release();
      return res.json({
        success: true,
        already_exists: true,
        job_id: jobRows[0].id,
        quote_id: quoteId,
        quote_number: quoteNumber,
        status: jobRows[0].status
      });
    }

    const [jobResult] = await connection.query(
      "INSERT INTO jobs (quote_id,status) VALUES (?, 'pendiente_presupuesto')",
      [quoteId]
    );

    await connection.query(
      `INSERT INTO quote_request_history
        (quote_request_id, actor_user_id, action, old_status, new_status, metadata)
       VALUES (?, ?, 'converted_to_job', ?, 'programada', ?)`,
      [id, req.session.user.id, request.status, JSON.stringify({ quote_id: quoteId, job_id: jobResult.insertId })]
    );

    await connection.query(
      "UPDATE quote_requests SET status='programada' WHERE id=?",
      [id]
    );

    await connection.commit();
    connection.release();

    await writeAudit(req, "request_converted_to_job", "quote_request", id, {
      quote_id: quoteId,
      job_id: jobResult.insertId
    });

    res.status(201).json({
      success: true,
      job_id: jobResult.insertId,
      quote_id: quoteId,
      quote_number: quoteNumber,
      status: "programada"
    });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error convirtiendo solicitud a trabajo", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo convertir la solicitud en trabajo." });
  }
});

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
    const token = String(req.params.token || "").trim();
    if (!/^[A-Za-z0-9_-]{24,200}$/.test(token)) {
      return res.status(404).json({ error: "Presupuesto no encontrado o enlace inválido." });
    }

    const [rows] = await pool.query(
      `SELECT
        q.id, q.quote_number, q.issue_date, q.expiration_date, q.notes,
        q.status, q.subtotal, q.discount, q.total, q.viewed_at,
        qr.name AS client_name, qr.email AS client_email, qr.phone AS client_phone,
        qr.service AS requested_service,
        qi.id AS item_id, qi.description, qi.quantity, qi.unit, qi.unit_price,
        qi.total AS item_total,
        qa.id AS acceptance_id, qa.decision AS acceptance_decision,
        qa.customer_name AS acceptance_customer_name,
        qa.customer_email AS acceptance_customer_email,
        qa.customer_phone AS acceptance_customer_phone,
        qa.customer_note AS acceptance_note,
        qa.consent_text AS acceptance_consent_text,
        qa.signature_name AS acceptance_signature_name,
        qa.ip_address AS acceptance_ip,
        qa.user_agent AS acceptance_user_agent,
        qa.created_at AS acceptance_created_at
      FROM quotes q
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN quote_items qi ON qi.quote_id=q.id
      LEFT JOIN (
        SELECT qa1.*
        FROM quote_acceptances qa1
        INNER JOIN (
          SELECT quote_id, MAX(id) AS max_id
          FROM quote_acceptances
          GROUP BY quote_id
        ) latest ON latest.max_id=qa1.id
      ) qa ON qa.quote_id=q.id
      WHERE q.access_token=?
      ORDER BY qi.id ASC`,
      [token]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Presupuesto no encontrado o enlace inválido." });
    }

    await pool.query(
      "UPDATE quotes SET viewed_at=COALESCE(viewed_at,NOW()) WHERE id=?",
      [rows[0].id]
    ).catch(() => {});

    const row = rows[0];
    const quote = {
      id: row.id,
      quote_number: row.quote_number,
      issue_date: row.issue_date,
      expiration_date: row.expiration_date,
      notes: row.notes,
      status: row.status,
      viewed_at: row.viewed_at,
      subtotal: row.subtotal,
      discount: row.discount,
      total: row.total,
      client_name: row.client_name,
      client_email: row.client_email,
      client_phone: row.client_phone,
      requested_service: row.requested_service,
      items: [],
      acceptance: row.acceptance_id ? {
        id: row.acceptance_id,
        decision: row.acceptance_decision,
        customer_name: row.acceptance_customer_name,
        customer_email: row.acceptance_customer_email,
        customer_phone: row.acceptance_customer_phone,
        note: row.acceptance_note,
        consent_text: row.acceptance_consent_text,
        signature_name: row.acceptance_signature_name,
        ip_address: row.acceptance_ip,
        user_agent: row.acceptance_user_agent,
        created_at: row.acceptance_created_at
      } : null
    };

    for (const item of rows) {
      if (item.item_id) {
        quote.items.push({
          id: item.item_id,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price,
          total: item.item_total
        });
      }
    }

    res.json(quote);
  } catch (error) {
    logError("Error obteniendo presupuesto público", { requestId:req.requestId, error:error.message });
    res.status(500).json({ error:"No se pudo obtener el presupuesto." });
  }
});
// ========================================
// PRESUPUESTOS - ADMIN
// ========================================

// =========================================================
// PRESUPUESTOS V2 — ADMIN
// =========================================================

const QUOTE_STATUSES = [
  "borrador",
  "enviado",
  "aceptado",
  "rechazado",
  "vencido",
  "cerrado"
];

function validateQuoteId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateQuoteStatus(value) {
  return QUOTE_STATUSES.includes(String(value || "").trim());
}

function validateQuoteDate(value) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  return text;
}

async function recordQuoteHistory(req, quoteId, action, oldStatus, newStatus, metadata = null, db = pool) {
  await db.query(
    `INSERT INTO quote_history
      (quote_id, actor_user_id, action, old_status, new_status, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      quoteId,
      req.session?.user?.id || null,
      action,
      oldStatus || null,
      newStatus || null,
      metadata ? JSON.stringify(metadata) : null
    ]
  );
}

async function notifyQuoteWhatsApp(quote) {
  try {
    const settings=await whatsappBusinessEnabled();
    if(!settings?.whatsapp_auto_notifications || !quote?.phone) return false;
    await queueWhatsApp({
      to:quote.phone,
      message:`JR Electricidad: tu presupuesto ${quote.quote_number} ya está disponible. Podés consultarlo en: ${(process.env.APP_URL || "")}/presupuesto/${encodeURIComponent(quote.access_token)}`,
      entityType:"quote",
      entityId:quote.id
    });
    return true;
  } catch(error) {
    logError("No se pudo encolar WhatsApp del presupuesto",{requestId:null,error:error.message,quoteId:quote?.id});
    return false;
  }
}

async function sendQuoteEmail(quote) {
  if (!quote?.email) return false;
  try {
    await queueEmail({
      to: quote.email,
      subject: "Presupuesto " + quote.quote_number + " - JR Electricidad",
      template: "quote_sent",
      data: {
        name: quote.name || quote.client_name || "",
        quoteNumber: quote.quote_number,
        total: quoteMoney(quote.total),
        link: (process.env.APP_URL || "") + "/presupuesto/" + encodeURIComponent(quote.access_token)
      }
    });
    return true;
  } catch (error) {
    logError("No se pudo encolar el presupuesto por email", {
      requestId: null,
      quoteId: quote.id,
      error: error.message
    });
    return false;
  }
}

// PDF del presupuesto.
app.get("/api/admin/quotes/:id(\\d+)/pdf", requireAdmin, async (req, res) => {
  try {
    const id = validateQuoteId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID de presupuesto inválido." });

    const quote = await getQuoteDetail(pool, id);
    if (!quote) return res.status(404).json({ error: "Presupuesto no encontrado." });

    const doc = buildQuotePdf(quote);
    const pdf = await pdfToBuffer(doc);
    const filename = quote.pdf_filename || `presupuesto-${quote.quote_number || id}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${String(filename).replace(/[^a-zA-Z0-9._-]/g, "_")}"`
    );
    res.setHeader("Content-Length", pdf.length);
    res.send(pdf);
  } catch (error) {
    logError("Error generando PDF del presupuesto", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo generar el PDF del presupuesto." });
  }
});

// Listado con búsqueda y filtros.
app.get("/api/admin/quotes", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    if (status && !validateQuoteStatus(status)) {
      return res.status(400).json({ error: "Estado de presupuesto inválido." });
    }

    const params = [];
    let sql = `
      SELECT
        q.id,q.quote_number,q.access_token,q.issue_date,q.expiration_date,
        q.subtotal,q.discount,q.total,q.status,q.sent_at,q.accepted_at,
        q.rejected_at,q.created_at,q.updated_at,
        qr.id AS quote_request_id,qr.name AS client_name,qr.email AS client_email,
        qr.phone AS client_phone,qr.service AS requested_service,
        COUNT(qi.id) AS items_count,
        j.id AS job_id,j.status AS job_status
      FROM quotes q
      INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
      LEFT JOIN quote_items qi ON qi.quote_id=q.id
      LEFT JOIN jobs j ON j.quote_id=q.id
      WHERE 1=1
    `;

    if (search) {
      const v = `%${search}%`;
      sql += " AND (q.quote_number LIKE ? OR qr.name LIKE ? OR qr.email LIKE ? OR qr.phone LIKE ? OR qr.service LIKE ?)";
      params.push(v,v,v,v,v);
    }
    if (status) {
      sql += " AND q.status=?";
      params.push(status);
    }
    if (dateFrom) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) return res.status(400).json({ error: "Fecha desde inválida." });
      sql += " AND DATE(q.created_at)>=?";
      params.push(dateFrom);
    }
    if (dateTo) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) return res.status(400).json({ error: "Fecha hasta inválida." });
      sql += " AND DATE(q.created_at)<=?";
      params.push(dateTo);
    }

    sql += `
      GROUP BY q.id,q.quote_number,q.access_token,q.issue_date,q.expiration_date,
        q.subtotal,q.discount,q.total,q.status,q.sent_at,q.accepted_at,q.rejected_at,
        q.created_at,q.updated_at,qr.id,qr.name,qr.email,qr.phone,qr.service,j.id,j.status
      ORDER BY q.created_at DESC,q.id DESC
    `;

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    logError("Error obteniendo presupuestos", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudieron obtener los presupuestos." });
  }
});

// Detalle completo.
app.get("/api/admin/quotes/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = validateQuoteId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID de presupuesto inválido." });

    const quote = await getQuoteDetail(pool, id);
    if (!quote) return res.status(404).json({ error: "Presupuesto no encontrado." });

    const [history] = await pool.query(
      `SELECT h.*,u.name AS actor_name
       FROM quote_history h
       LEFT JOIN users u ON u.id=h.actor_user_id
       WHERE h.quote_id=?
       ORDER BY h.created_at DESC,h.id DESC`,
      [id]
    );

    const [jobs] = await pool.query(
      "SELECT id,status,started_at,completed_at,created_at,updated_at FROM jobs WHERE quote_id=? ORDER BY id DESC",
      [id]
    );

    res.json({ ...quote, history, jobs });
  } catch (error) {
    logError("Error obteniendo detalle de presupuesto", { requestId: req.requestId, error: error.message });
    res.status(500).json({ error: "No se pudo obtener el presupuesto." });
  }
});

// Crear presupuesto.
app.post("/api/admin/quotes", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const body = req.body || {};
    const requestId = validateRequestId(body.quote_request_id);
    if (!requestId) {
      connection.release();
      return res.status(400).json({ error: "La solicitud asociada es obligatoria." });
    }

    const issueDate = validateQuoteDate(body.issue_date);
    const expirationDate = validateQuoteDate(body.expiration_date);
    if (issueDate === undefined || expirationDate === undefined) {
      connection.release();
      return res.status(400).json({ error: "Las fechas del presupuesto no son válidas." });
    }

    const discount = Number(body.discount || 0);
    if (!Number.isFinite(discount) || discount < 0 || discount > 1000000000) {
      connection.release();
      return res.status(400).json({ error: "El descuento no es válido." });
    }

    const items = cleanQuoteItems(body.items);
    const subtotal = items.reduce((sum,item) => sum + item.total, 0);
    if (discount > subtotal) {
      connection.release();
      return res.status(400).json({ error: "El descuento no puede superar el subtotal." });
    }
    const total = subtotal - discount;
    const notes = String(body.notes || "").trim();
    if (notes.length > 5000) {
      connection.release();
      return res.status(400).json({ error: "Las notas no pueden superar 5000 caracteres." });
    }

    await connection.beginTransaction();

    const [requestRows] = await connection.query(
      "SELECT * FROM quote_requests WHERE id=? LIMIT 1 FOR UPDATE",
      [requestId]
    );
    if (!requestRows.length) {
      await connection.rollback(); connection.release();
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const quoteNumber = `PR-${new Date().toISOString().replace(/\D/g,"").slice(0,14)}-${requestId}`;
    const accessToken = crypto.randomBytes(32).toString("hex");

    const [result] = await connection.query(
      `INSERT INTO quotes
       (quote_request_id,quote_number,access_token,issue_date,expiration_date,notes,status,subtotal,discount,total)
       VALUES (?,?,?,?,?,?,'borrador',?,?,?)`,
      [requestId,quoteNumber,accessToken,issueDate || new Date().toISOString().slice(0,10),expirationDate,notes,subtotal,discount,total]
    );

    for (const item of items) {
      await connection.query(
        `INSERT INTO quote_items (quote_id,description,quantity,unit,unit_price,total)
         VALUES (?,?,?,?,?,?)`,
        [result.insertId,item.description,item.quantity,item.unit,item.unit_price,item.total]
      );
    }

    await connection.query(
      `INSERT INTO quote_history (quote_id,actor_user_id,action,new_status,metadata)
       VALUES (?,?,'quote_created','borrador',?)`,
      [result.insertId,req.session.user.id,JSON.stringify({ quote_request_id: requestId, items: items.length })]
    );

    await connection.commit();
    connection.release();

    await writeAudit(req,"quote_created","quote",result.insertId,{quote_request_id:requestId,total});

    res.status(201).json({
      success:true,
      id:result.insertId,
      quote_id:result.insertId,
      quote_number:quoteNumber,
      total
    });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error creando presupuesto", { requestId:req.requestId, error:error.message });
    res.status(500).json({ error:"No se pudo crear el presupuesto." });
  }
});

// Actualizar presupuesto.
app.put("/api/admin/quotes/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = validateQuoteId(req.params.id);
    if (!id) { connection.release(); return res.status(400).json({error:"ID de presupuesto inválido."}); }

    const body = req.body || {};
    const issueDate = validateQuoteDate(body.issue_date);
    const expirationDate = validateQuoteDate(body.expiration_date);
    if (issueDate === undefined || expirationDate === undefined) {
      connection.release(); return res.status(400).json({error:"Las fechas del presupuesto no son válidas."});
    }

    const discount = Number(body.discount || 0);
    if (!Number.isFinite(discount) || discount < 0 || discount > 1000000000) {
      connection.release(); return res.status(400).json({error:"El descuento no es válido."});
    }

    const items = cleanQuoteItems(body.items);
    const subtotal = items.reduce((sum,item)=>sum+item.total,0);
    if (discount > subtotal) {
      connection.release(); return res.status(400).json({error:"El descuento no puede superar el subtotal."});
    }
    const total = subtotal-discount;
    const notes = String(body.notes || "").trim();
    if (notes.length > 5000) {
      connection.release(); return res.status(400).json({error:"Las notas no pueden superar 5000 caracteres."});
    }

    await connection.beginTransaction();

    const [rows] = await connection.query("SELECT * FROM quotes WHERE id=? LIMIT 1 FOR UPDATE",[id]);
    if (!rows.length) {
      await connection.rollback(); connection.release();
      return res.status(404).json({error:"Presupuesto no encontrado."});
    }

    const current = rows[0];
    if (["aceptado","cerrado"].includes(current.status)) {
      await connection.rollback(); connection.release();
      return res.status(409).json({error:"No se puede modificar un presupuesto aceptado o cerrado."});
    }

    await connection.query(
      `UPDATE quotes
       SET issue_date=?,expiration_date=?,notes=?,subtotal=?,discount=?,total=?
       WHERE id=?`,
      [issueDate || current.issue_date,expirationDate,notes,subtotal,discount,total,id]
    );

    await connection.query("DELETE FROM quote_items WHERE quote_id=?",[id]);
    for (const item of items) {
      await connection.query(
        `INSERT INTO quote_items (quote_id,description,quantity,unit,unit_price,total)
         VALUES (?,?,?,?,?,?)`,
        [id,item.description,item.quantity,item.unit,item.unit_price,item.total]
      );
    }

    await connection.query(
      `INSERT INTO quote_history (quote_id,actor_user_id,action,old_status,new_status,metadata)
       VALUES (?,?,'quote_updated',?,?,?)`,
      [id,req.session.user.id,current.status,current.status,JSON.stringify({subtotal,discount,total,items:items.length})]
    );

    await connection.commit();
    connection.release();

    await writeAudit(req,"quote_updated","quote",id,{subtotal,discount,total});

    res.json({success:true,message:"Presupuesto actualizado correctamente.",total});
  } catch (error) {
    try { await connection.rollback(); } catch {}
    connection.release();
    logError("Error actualizando presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar el presupuesto."});
  }
});

// Cambiar estado y enviar al cliente.
app.patch("/api/admin/quotes/:id(\\d+)/status", requireAdmin, adminMutationLimiter, async (req,res)=>{
  const id=validateQuoteId(req.params.id);
  const status=String(req.body?.status||"").trim();

  if(!id || !validateQuoteStatus(status)) {
    return res.status(400).json({error:"Estado de presupuesto inválido."});
  }

  try {
    const [rows]=await pool.query(
      `SELECT q.*,qr.name,qr.email
       FROM quotes q INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE q.id=? LIMIT 1`,[id]
    );
    if(!rows.length) return res.status(404).json({error:"Presupuesto no encontrado."});
    const current=rows[0];

    if(["aceptado","cerrado"].includes(current.status) && current.status!==status) {
      return res.status(409).json({error:"El presupuesto ya está cerrado para cambios."});
    }

    const allowedTransitions={
      borrador:["borrador","enviado","cerrado"],
      enviado:["enviado","aceptado","rechazado","vencido","cerrado"],
      aceptado:["aceptado","cerrado"],
      rechazado:["rechazado","borrador","cerrado"],
      vencido:["vencido","borrador","cerrado"],
      cerrado:["cerrado"]
    };

    if(!allowedTransitions[current.status]?.includes(status)) {
      return res.status(409).json({error:`No se puede pasar de "${current.status}" a "${status}".`});
    }

    const sentAt=status==="enviado" ? new Date() : current.sent_at;
    const acceptedAt=status==="aceptado" ? new Date() : current.accepted_at;
    const rejectedAt=status==="rechazado" ? new Date() : current.rejected_at;

    await pool.query(
      `UPDATE quotes SET status=?,sent_at=?,accepted_at=?,rejected_at=? WHERE id=?`,
      [status,sentAt,acceptedAt,rejectedAt,id]
    );

    await recordQuoteHistory(req,id,"quote_status_changed",current.status,status,{});

    await writeAudit(req,"quote_status_changed","quote",id,{old_status:current.status,new_status:status});

    if(status==="enviado") {
      const sent=await sendQuoteEmail({...current,status,total:current.total});
      await notifyQuoteWhatsApp({...current,status,total:current.total});
      await createAdminNotification({
        type: "quote_sent",
        quoteId: id,
        entityType: "quote",
        entityId: id,
        message: `El presupuesto ${current.quote_number} fue marcado como enviado.`,
        linkUrl: "/admin.html#quotesSection",
        priority: "normal"
      }).catch(() => {});
      res.json({success:true,status,email_sent:sent,message:sent?"Presupuesto enviado al cliente.":"Presupuesto marcado como enviado; email no disponible o no configurado."});
      return;
    }

    if(status==="aceptado") {
      await pool.query(
        "UPDATE quote_requests SET status='aceptada' WHERE id=? AND status NOT IN ('cerrada','finalizada')",
        [current.quote_request_id]
      );
    }

    res.json({success:true,status});
  } catch(error) {
    logError("Error cambiando estado del presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo cambiar el estado del presupuesto."});
  }
});

// Eliminar solamente borradores.
app.delete("/api/admin/quotes/:id(\\d+)", requireAdmin, adminMutationLimiter, async (req,res)=>{
  try {
    const id=validateQuoteId(req.params.id);
    if(!id) return res.status(400).json({error:"ID de presupuesto inválido."});

    const [rows]=await pool.query("SELECT status,quote_number FROM quotes WHERE id=? LIMIT 1",[id]);
    if(!rows.length) return res.status(404).json({error:"Presupuesto no encontrado."});
    if(rows[0].status!=="borrador") return res.status(409).json({error:"Solo se pueden eliminar presupuestos en borrador."});

    await pool.query("DELETE FROM quotes WHERE id=?",[id]);
    await writeAudit(req,"quote_deleted","quote",id,{quote_number:rows[0].quote_number});
    res.json({success:true,message:"Presupuesto eliminado."});
  } catch(error) {
    logError("Error eliminando presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo eliminar el presupuesto."});
  }
});

// Historial del presupuesto.
app.get("/api/admin/quotes/:id(\\d+)/history", requireAdmin, async (req,res)=>{
  try {
    const id=validateQuoteId(req.params.id);
    if(!id) return res.status(400).json({error:"ID de presupuesto inválido."});
    const [rows]=await pool.query(
      `SELECT h.*,u.name AS actor_name
       FROM quote_history h LEFT JOIN users u ON u.id=h.actor_user_id
       WHERE h.quote_id=? ORDER BY h.created_at DESC,h.id DESC`,[id]
    );
    res.json(rows);
  } catch(error) {
    logError("Error obteniendo historial de presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el historial del presupuesto."});
  }
});

// =====================================================
// NOTIFICACIONES DEL ADMINISTRADOR — V2
// =====================================================

app.get("/api/admin/notifications", requireAdmin, async (req,res) => {
  try {
    const limitRaw = Number(req.query.limit || 50);
    const limit = Math.min(Math.max(Number.isInteger(limitRaw) ? limitRaw : 50, 1), 100);
    const includeArchived = String(req.query.archived || "") === "1";
    const recipient = Number(req.session.user.id);

    const [rows] = await pool.query(
      `SELECT id,user_id,type,quote_id,entity_type,entity_id,message,link_url,priority,
              is_read,read_at,archived_at,created_at
       FROM admin_notifications
       WHERE (user_id IS NULL OR user_id=?)
         AND (?=1 OR archived_at IS NULL)
       ORDER BY is_read ASC, created_at DESC, id DESC
       LIMIT ${limit}`,
      [recipient, includeArchived ? 1 : 0]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS unread
       FROM admin_notifications
       WHERE (user_id IS NULL OR user_id=?)
         AND is_read=0
         AND archived_at IS NULL`,
      [recipient]
    );

    res.json({
      success:true,
      notifications:rows,
      unread:Number(countRows[0]?.unread || 0)
    });
  } catch(error) {
    logError("Error obteniendo notificaciones",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron obtener las notificaciones."});
  }
});

app.post("/api/admin/notifications/:id/read", requireAdmin, async (req,res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de notificación inválido."});
    const [result]=await pool.query(
      `UPDATE admin_notifications
       SET is_read=1,read_at=COALESCE(read_at,NOW())
       WHERE id=? AND (user_id IS NULL OR user_id=?) AND archived_at IS NULL`,
      [id,Number(req.session.user.id)]
    );
    if(!result.affectedRows) return res.status(404).json({error:"Notificación no encontrada."});
    res.json({success:true,message:"Notificación marcada como leída."});
  } catch(error) {
    logError("Error marcando notificación",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo actualizar la notificación."});
  }
});

app.post("/api/admin/notifications/read-all", requireAdmin, async (req,res) => {
  try {
    await pool.query(
      `UPDATE admin_notifications
       SET is_read=1,read_at=COALESCE(read_at,NOW())
       WHERE (user_id IS NULL OR user_id=?)
         AND is_read=0 AND archived_at IS NULL`,
      [Number(req.session.user.id)]
    );
    res.json({success:true,message:"Todas las notificaciones fueron marcadas como leídas."});
  } catch(error) {
    logError("Error marcando notificaciones",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron marcar las notificaciones como leídas."});
  }
});

app.post("/api/admin/notifications/:id/archive", requireAdmin, async (req,res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:"ID de notificación inválido."});
    const [result]=await pool.query(
      `UPDATE admin_notifications
       SET archived_at=NOW(),is_read=1,read_at=COALESCE(read_at,NOW())
       WHERE id=? AND (user_id IS NULL OR user_id=?) AND archived_at IS NULL`,
      [id,Number(req.session.user.id)]
    );
    if(!result.affectedRows) return res.status(404).json({error:"Notificación no encontrada."});
    res.json({success:true,message:"Notificación archivada."});
  } catch(error) {
    logError("Error archivando notificación",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo archivar la notificación."});
  }
});

app.post("/api/admin/notifications/archive-all", requireAdmin, async (req,res) => {
  try {
    await pool.query(
      `UPDATE admin_notifications
       SET archived_at=NOW(),is_read=1,read_at=COALESCE(read_at,NOW())
       WHERE (user_id IS NULL OR user_id=?) AND archived_at IS NULL`,
      [Number(req.session.user.id)]
    );
    res.json({success:true,message:"Todas las notificaciones fueron archivadas."});
  } catch(error) {
    logError("Error archivando notificaciones",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron archivar las notificaciones."});
  }
});

// =========================================================
// V2 — EMAIL / ESTADO DE ENTREGA
// =========================================================

app.get("/api/admin/email/status", requireAdmin, async (req,res) => {
  try {
    const [rows] = await pool.query(
      `SELECT status,COUNT(*) AS total,MAX(created_at) AS last_created,MAX(sent_at) AS last_sent
       FROM email_outbox GROUP BY status ORDER BY status`
    );
    res.json({
      success:true,
      smtp_configured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.MAIL_FROM),
      statuses: rows
    });
  } catch(error) {
    logError("Error obteniendo estado de email",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el estado del email."});
  }
});

app.get("/api/admin/email/outbox", requireAdmin, async (req,res) => {
  try {
    const limit=Math.min(Math.max(Number(req.query.limit)||50,1),100);
    const status=String(req.query.status||"").trim();
    const params=[];
    let sql=`SELECT id,to_email,subject,template,status,attempts,max_attempts,next_attempt_at,sent_at,last_error,provider_message_id,request_id,created_at,updated_at
              FROM email_outbox WHERE 1=1`;
    if(status){
      const allowed=["queued","sending","sent","failed","skipped"];
      if(!allowed.includes(status)) return res.status(400).json({error:"Estado de email inválido."});
      sql+=" AND status=?";
      params.push(status);
    }
    sql+=" ORDER BY id DESC LIMIT "+limit;
    const [rows]=await pool.query(sql,params);
    res.json({success:true,emails:rows});
  } catch(error) {
    logError("Error obteniendo cola de email",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener la cola de email."});
  }
});

// =========================================================
// V2 — WHATSAPP
// =========================================================

async function whatsappBusinessEnabled() {
  const [rows] = await pool.query(
    "SELECT whatsapp,whatsapp_enabled,whatsapp_auto_notifications FROM business_settings WHERE id=1 LIMIT 1"
  );
  return rows[0] || null;
}

app.get("/api/admin/whatsapp/status", requireAdmin, async (req,res) => {
  try {
    const settings=await whatsappBusinessEnabled();
    const [rows]=await pool.query(
      "SELECT status,COUNT(*) AS total,MAX(created_at) AS last_created,MAX(sent_at) AS last_sent FROM whatsapp_outbox GROUP BY status"
    );
    res.json({
      success:true,
      provider_configured: whatsappProviderConfigured(),
      settings: settings || null,
      statuses: rows
    });
  } catch(error) {
    logError("Error obteniendo estado de WhatsApp",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener el estado de WhatsApp."});
  }
});

app.get("/api/admin/whatsapp/outbox", requireAdmin, async (req,res) => {
  try {
    const limit=Math.min(Math.max(Number(req.query.limit)||50,1),100);
    const status=String(req.query.status||"").trim();
    const params=[];
    let sql=`SELECT id,to_phone,message,status,attempts,max_attempts,next_attempt_at,sent_at,last_error,provider_message_id,entity_type,entity_id,request_id,created_at,updated_at
              FROM whatsapp_outbox WHERE 1=1`;
    if(status){
      const allowed=["queued","sending","sent","failed","skipped"];
      if(!allowed.includes(status)) return res.status(400).json({error:"Estado de WhatsApp inválido."});
      sql+=" AND status=?";
      params.push(status);
    }
    sql+=" ORDER BY id DESC LIMIT "+limit;
    const [rows]=await pool.query(sql,params);
    res.json({success:true,messages:rows});
  } catch(error) {
    logError("Error obteniendo outbox de WhatsApp",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo obtener la cola de WhatsApp."});
  }
});

app.post("/api/admin/whatsapp/send", requireAdmin, adminMutationLimiter, async (req,res) => {
  try {
    const phone=String(req.body.phone||"").trim();
    const message=String(req.body.message||"").trim();
    if(!phone || !message) return res.status(400).json({error:"Teléfono y mensaje son obligatorios."});
    const result=await queueWhatsApp({
      to:phone,
      message,
      requestId:req.requestId,
      entityType:String(req.body.entity_type||"manual").slice(0,50),
      entityId:req.body.entity_id ? Number(req.body.entity_id) : null
    });
    await writeAudit(req,"whatsapp_queued","whatsapp",result.id,{phone:result.phone});
    res.json({success:true,...result});
  } catch(error) {
    logError("Error encolando WhatsApp manual",{requestId:req.requestId,error:error.message});
    res.status(400).json({error:error.message});
  }
});

app.post("/api/admin/whatsapp/link", requireAdmin, async (req,res) => {
  try {
    const phone=String(req.body.phone||"").trim();
    const message=String(req.body.message||"").trim();
    const link=buildWhatsAppLink(phone,message);
    if(!link) return res.status(400).json({error:"Número de WhatsApp inválido."});
    res.json({success:true,link});
  } catch(error) {
    res.status(400).json({error:"No se pudo generar el enlace de WhatsApp."});
  }
});

// =========================================================
// V2 — ACEPTACIÓN DIGITAL DE PRESUPUESTOS
// =========================================================

const ACCEPTANCE_CONSENT_TEXT =
  "Declaro que revisé el presupuesto, sus conceptos, importes y condiciones, y autorizo a JR Electricidad a registrar digitalmente mi decisión.";

function validatePublicCustomer(body) {
  const name = String(body?.name || "").trim().replace(/\s+/g," ");
  const email = String(body?.email || "").trim().toLowerCase();
  const phone = String(body?.phone || "").trim();
  const note = String(body?.note || "").trim();
  const signatureName = String(body?.signatureName || "").trim().replace(/\s+/g," ");
  if(name.length<2||name.length>150) return {error:"Ingresá un nombre válido."};
  if(!validEmail(email)) return {error:"Ingresá un email válido."};
  if(phone.length<6||phone.length>50) return {error:"Ingresá un teléfono válido."};
  if(note.length>2000) return {error:"La observación no puede superar 2000 caracteres."};
  if(signatureName.length<2||signatureName.length>150) return {error:"Ingresá tu nombre como firma digital."};
  return {name,email,phone,note,signatureName};
}

function publicQuoteToken(req) {
  const token=String(req.params.token||"").trim();
  return /^[A-Za-z0-9_-]{24,200}$/.test(token) ? token : null;
}

async function sendAcceptanceEmail({to,quoteNumber,decision,customerName}) {
  if (!to) return false;
  try {
    await queueEmail({
      to,
      subject: (decision==="aceptado"?"Aceptación":"Rechazo") + " de presupuesto " + quoteNumber + " - JR Electricidad",
      template: "quote_decision",
      data: { customerName, quoteNumber, decision }
    });
    return true;
  } catch(error) {
    logError("No se pudo encolar confirmación de aceptación", {
      requestId:null,
      error:error.message,
      quoteNumber
    });
    return false;
  }
}

async function processPublicQuoteDecision(req,res,decision) {
  const token=publicQuoteToken(req);
  if(!token) return res.status(404).json({error:"Presupuesto no encontrado o enlace inválido."});
  const customer=validatePublicCustomer(req.body||{});
  if(customer.error) return res.status(400).json({error:customer.error});
  if(decision==="aceptado"&&req.body?.consent!==true) {
    return res.status(400).json({error:"Debés aceptar la constancia digital antes de confirmar."});
  }

  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]=await connection.query(
      `SELECT q.*,qr.name AS client_name,qr.email AS client_email,qr.phone AS client_phone
       FROM quotes q
       INNER JOIN quote_requests qr ON qr.id=q.quote_request_id
       WHERE q.access_token=? LIMIT 1 FOR UPDATE`,
      [token]
    );
    if(!rows.length) {
      await connection.rollback();
      return res.status(404).json({error:"Presupuesto no encontrado o enlace inválido."});
    }

    const quote=rows[0];
    if(["cerrado","vencido"].includes(quote.status) ||
       (quote.expiration_date && new Date(quote.expiration_date).getTime() < new Date().setHours(0,0,0,0))) {
      await connection.rollback();
      return res.status(409).json({error:"Este presupuesto está vencido o cerrado y ya no admite una decisión."});
    }
    if(quote.status===decision) {
      await connection.rollback();
      return res.json({success:true,status:decision,already_decided:true,message:`El presupuesto ya figura como ${decision}.`});
    }
    if(quote.status!=="enviado") {
      await connection.rollback();
      return res.status(409).json({error:"Este presupuesto no está disponible para una nueva decisión."});
    }

    const ip=req.ip||null;
    const userAgent=String(req.get("user-agent")||"").slice(0,512)||null;

    const [insertResult]=await connection.query(
      `INSERT INTO quote_acceptances
       (quote_id,decision,customer_name,customer_email,customer_phone,customer_note,consent_text,signature_name,ip_address,user_agent)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [quote.id,decision,customer.name,customer.email,customer.phone,customer.note||null,
       decision==="aceptado"?ACCEPTANCE_CONSENT_TEXT:null,customer.signatureName,ip,userAgent]
    );

    if(decision==="aceptado") {
      await connection.query(
        "UPDATE quotes SET status='aceptado',accepted_at=NOW() WHERE id=?",
        [quote.id]
      );
      await connection.query(
        "UPDATE quote_requests SET status='aceptada' WHERE id=? AND status NOT IN ('cerrada','finalizada')",
        [quote.quote_request_id]
      );
      await connection.query(
        `INSERT INTO jobs (quote_id,status) VALUES (?, 'aceptado')
         ON DUPLICATE KEY UPDATE status='aceptado',updated_at=CURRENT_TIMESTAMP`,
        [quote.id]
      );
    } else {
      await connection.query(
        "UPDATE quotes SET status='rechazado',rejected_at=NOW() WHERE id=?",
        [quote.id]
      );
    }

    await connection.query(
      `INSERT INTO quote_history (quote_id,action,old_status,new_status,metadata)
       VALUES (?,'customer_decision','enviado',?,?)`,
      [quote.id,decision,JSON.stringify({
        source:"public",
        acceptance_id:insertResult.insertId,
        customer_name:customer.name,
        customer_email:customer.email,
        consent:decision==="aceptado"
      })]
    );

    await connection.query(
      "INSERT INTO admin_notifications (user_id,type,quote_id,entity_type,entity_id,message,link_url,priority,is_read,read_at,archived_at) VALUES (NULL,?,?,?,?,?,?,?,0,NULL,NULL)",
      [
        decision==="aceptado"?"quote_accepted":"quote_rejected",
        quote.id,
        "quote",
        quote.id,
        `El cliente ${quote.client_name} registró ${decision==="aceptado"?"la aceptación":"el rechazo"} del presupuesto ${quote.quote_number}.`,
        "/admin.html#quotesSection",
        "high"
      ]
    );

    await connection.commit();

    const emailSent=await sendAcceptanceEmail({
      to:customer.email,
      quoteNumber:quote.quote_number,
      decision,
      customerName:customer.name
    });

    await writeAudit(req,`quote_${decision}_public`,"quote",quote.id,{
      customer_name:customer.name,
      customer_email:customer.email,
      ip,
      user_agent:userAgent,
      email_sent:emailSent
    });

    res.json({
      success:true,
      status:decision,
      email_sent:emailSent,
      message:decision==="aceptado"
        ?"Presupuesto aceptado. Se registró tu aceptación y se creó el trabajo."
        :"Presupuesto rechazado. Se registró tu decisión correctamente."
    });
  } catch(error) {
    await connection.rollback().catch(()=>{});
    logError("Error procesando decisión pública del presupuesto",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudo registrar la decisión del presupuesto."});
  } finally {
    connection.release();
  }
}

app.post("/api/public/quotes/:token/accept",authLimiter,async(req,res)=>{
  return processPublicQuoteDecision(req,res,"aceptado");
});

app.post("/api/public/quotes/:token/reject",authLimiter,async(req,res)=>{
  return processPublicQuoteDecision(req,res,"rechazado");
});




// =========================================================
// FASE 14 — GESTIÓN CENTRALIZADA DE DOCUMENTOS
// =========================================================

function validateDocumentEntityId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function documentAbsolutePath(storedName) {
  const base = path.resolve(documentsDir);
  const target = path.resolve(base, String(storedName || ""));
  if (target !== base && !target.startsWith(base + path.sep)) {
    return null;
  }
  return target;
}

async function createStoredDocument({
  title,
  description = null,
  documentType,
  clientId = null,
  quoteRequestId = null,
  quoteId = null,
  jobId = null,
  originalName,
  mimeType,
  filePath,
  createdByUserId
}) {
  const type = normalizeDocumentType(documentType);
  if (!type) throw new Error("Tipo de documento inválido.");
  const stat = await fs.promises.stat(filePath);
  if (stat.size > MAX_DOCUMENT_SIZE) throw new Error("El documento supera los 10 MB.");
  const handle = await fs.promises.open(filePath, "r");
  const header = Buffer.alloc(16);
  try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }
  if (!validateDocumentSignature(header, mimeType)) {
    throw new Error("La firma del archivo no coincide con su tipo.");
  }

  const safeName = safeDocumentName(originalName);
  const storedName = path.basename(filePath);
  const sha256 = await sha256File(filePath);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [docResult] = await connection.query(
      `INSERT INTO documents
        (document_type,title,description,client_id,quote_request_id,quote_id,job_id,created_by_user_id,current_version)
       VALUES (?,?,?,?,?,?,?,?,1)`,
      [
        type,
        String(title || safeName).trim().slice(0,255) || safeName,
        description ? String(description).trim().slice(0,10000) : null,
        clientId, quoteRequestId, quoteId, jobId, createdByUserId || null
      ]
    );
    const documentId = Number(docResult.insertId);
    await connection.query(
      `INSERT INTO document_versions
        (document_id,version_number,original_name,stored_name,storage_path,mime_type,size_bytes,sha256,created_by_user_id)
       VALUES (?,1,?,?,?,?,?,?,?)`,
      [documentId, safeName, storedName, "documents/" + storedName, mimeType, stat.size, sha256, createdByUserId || null]
    );
    await connection.commit();
    return { documentId, version: 1, sha256, sizeBytes: stat.size };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function createDocumentVersion(documentId, file, userId) {
  const id = validateDocumentEntityId(documentId);
  if (!id) throw new Error("ID de documento inválido.");
  const stat = await fs.promises.stat(file.path);
  if (stat.size > MAX_DOCUMENT_SIZE) throw new Error("El documento supera los 10 MB.");
  const handle = await fs.promises.open(file.path, "r");
  const header = Buffer.alloc(16);
  try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }
  if (!validateDocumentSignature(header, file.mimetype)) throw new Error("La firma del archivo no coincide con su tipo.");

  const [docs] = await pool.query("SELECT id,current_version FROM documents WHERE id=? LIMIT 1", [id]);
  if (!docs.length) throw new Error("Documento no encontrado.");
  const version = Number(docs[0].current_version || 0) + 1;
  const sha256 = await sha256File(file.path);
  await pool.query(
    `INSERT INTO document_versions
      (document_id,version_number,original_name,stored_name,storage_path,mime_type,size_bytes,sha256,created_by_user_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id,version,safeDocumentName(file.originalname),path.basename(file.path),"documents/"+path.basename(file.path),file.mimetype,stat.size,sha256,userId || null]
  );
  await pool.query("UPDATE documents SET current_version=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [version,id]);
  return { version, sha256, sizeBytes: stat.size };
}

async function buildJobDocumentPdf(job, type) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(20).text("JR ELECTRICIDAD");
  doc.fillColor("#f59e0b").fontSize(9).text("Electricista Matriculado · Cat. 3");
  doc.moveDown(1.2);
  doc.fillColor("#111827").fontSize(16).text(type === "work_completion" ? "CONSTANCIA DE TRABAJO" : "INFORME DE TRABAJO");
  doc.moveDown(.8);
  const lines = [
    ["Trabajo", "#" + job.id],
    ["Cliente", job.client_name || "-"],
    ["Teléfono", job.client_phone || "-"],
    ["Servicio", job.service || "-"],
    ["Estado", job.status || "-"],
    ["Ubicación", job.location || "-"],
    ["Programado", job.scheduled_at ? new Date(job.scheduled_at).toLocaleString("es-AR") : "-"],
    ["Inicio", job.started_at ? new Date(job.started_at).toLocaleString("es-AR") : "-"],
    ["Finalización", job.completed_at ? new Date(job.completed_at).toLocaleString("es-AR") : "-"],
    ["Técnico", job.technician_name || "-"]
  ];
  for (const [label,value] of lines) {
    doc.fillColor("#6b7280").font("Helvetica-Bold").fontSize(9).text(label.toUpperCase());
    doc.fillColor("#111827").font("Helvetica").fontSize(11).text(String(value));
    doc.moveDown(.35);
  }
  if (job.execution_notes) {
    doc.moveDown(.4).fillColor("#111827").font("Helvetica-Bold").fontSize(10).text("NOTAS DE EJECUCIÓN");
    doc.font("Helvetica").fontSize(10).text(String(job.execution_notes));
  }
  if (job.completion_notes) {
    doc.moveDown(.4).fillColor("#111827").font("Helvetica-Bold").fontSize(10).text("NOTAS DE FINALIZACIÓN");
    doc.font("Helvetica").fontSize(10).text(String(job.completion_notes));
  }
  doc.moveDown(2);
  doc.fillColor("#6b7280").fontSize(8).text("Documento generado por el panel de administración de JR Electricidad.");
  return pdfToBuffer(doc);
}

async function createGeneratedPdfDocument({ title, type, pdf, clientId, quoteRequestId, quoteId, jobId, userId, fileName }) {
  const tmp = path.join(documentsDir, documentFileName(fileName || "documento.pdf"));
  await fs.promises.writeFile(tmp, pdf);
  try {
    return await createStoredDocument({
      title, documentType:type, clientId, quoteRequestId, quoteId, jobId,
      originalName:fileName || "documento.pdf",
      mimeType:"application/pdf", filePath:tmp, createdByUserId:userId
    });
  } catch (error) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw error;
  }
}

app.get("/api/admin/documents", requireAdmin, async (req,res)=>{
  try {
    const q=String(req.query.q||"").trim().slice(0,120);
    const type=String(req.query.type||"").trim();
    const params=[];
    const where=[];
    if(q){
      where.push("(d.title LIKE ? OR d.description LIKE ? OR dv.original_name LIKE ? OR c.name LIKE ?)");
      const like="%"+q+"%"; params.push(like,like,like,like);
    }
    if(type){
      const normalized=normalizeDocumentType(type);
      if(!normalized) return res.status(400).json({error:"Tipo de documento inválido."});
      where.push("d.document_type=?"); params.push(normalized);
    }
    const sql=`SELECT d.id,d.document_type,d.title,d.description,d.client_id,d.quote_request_id,d.quote_id,d.job_id,
      d.current_version,d.created_at,d.updated_at,
      dv.id AS version_id,dv.original_name,dv.mime_type,dv.size_bytes,dv.sha256,dv.created_at AS version_created_at,
      c.name AS client_name
      FROM documents d
      INNER JOIN document_versions dv ON dv.document_id=d.id AND dv.version_number=d.current_version
      LEFT JOIN clients c ON c.id=d.client_id
      ${where.length?"WHERE "+where.join(" AND "):""}
      ORDER BY d.updated_at DESC,d.id DESC LIMIT 200`;
    const [rows]=await pool.query(sql,params);
    res.json({types:DOCUMENT_TYPES,documents:rows});
  }catch(error){
    logError("Error listando documentos",{requestId:req.requestId,error:error.message});
    res.status(500).json({error:"No se pudieron obtener los documentos."});
  }
});

app.get("/api/admin/documents/:id(\\d+)", requireAdmin, async(req,res)=>{
  try{
    const id=validateDocumentEntityId(req.params.id);
    if(!id) return res.status(400).json({error:"ID de documento inválido."});
    const [docs]=await pool.query(
      `SELECT d.*,c.name AS client_name FROM documents d LEFT JOIN clients c ON c.id=d.client_id WHERE d.id=? LIMIT 1`,[id]);
    if(!docs.length) return res.status(404).json({error:"Documento no encontrado."});
    const [versions]=await pool.query(
      `SELECT v.id,v.version_number,v.original_name,v.mime_type,v.size_bytes,v.sha256,v.created_at,u.name AS created_by_name
       FROM document_versions v LEFT JOIN users u ON u.id=v.created_by_user_id WHERE v.document_id=? ORDER BY v.version_number DESC`,[id]);
    res.json({...docs[0],versions});
  }catch(error){res.status(500).json({error:"No se pudo obtener el documento."});}
});

app.get("/api/admin/documents/:id(\\d+)/download", requireAdmin, async(req,res)=>{
  try{
    const id=validateDocumentEntityId(req.params.id);
    const version=req.query.version==null?null:Number(req.query.version);
    if(!id) return res.status(400).json({error:"ID de documento inválido."});
    let sql=`SELECT d.title,v.* FROM documents d INNER JOIN document_versions v ON v.document_id=d.id
      WHERE d.id=? ${version? "AND v.version_number=?":"AND v.version_number=d.current_version"} LIMIT 1`;
    const params=version?[id,version]:[id];
    const [rows]=await pool.query(sql,params);
    if(!rows.length) return res.status(404).json({error:"Versión de documento no encontrada."});
    const filePath=documentAbsolutePath(rows[0].stored_name);
    if(!filePath || !fs.existsSync(filePath)) return res.status(404).json({error:"Archivo no encontrado en almacenamiento."});
    await writeAudit(req,"document_downloaded","document",id,{version:rows[0].version_number});
    res.setHeader("Content-Type",rows[0].mime_type);
    res.setHeader("Content-Disposition",`attachment; filename="${safeDocumentName(rows[0].original_name)}"`);
    res.sendFile(filePath);
  }catch(error){logError("Error descargando documento",{requestId:req.requestId,error:error.message});res.status(500).json({error:"No se pudo descargar el documento."});}
});

app.post("/api/admin/documents/upload", requireAdmin, adminMutationLimiter, documentUpload.single("file"), async(req,res)=>{
  try{
    if(!req.file) return res.status(400).json({error:"Seleccioná un archivo."});
    const documentType=normalizeDocumentType(req.body.document_type);
    if(!documentType){await fs.promises.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:"Tipo de documento inválido."});}
    const result=await createStoredDocument({
      title:String(req.body.title||req.file.originalname).trim(),
      description:req.body.description,
      documentType,
      clientId:validateDocumentEntityId(req.body.client_id),
      quoteRequestId:validateDocumentEntityId(req.body.quote_request_id),
      quoteId:validateDocumentEntityId(req.body.quote_id),
      jobId:validateDocumentEntityId(req.body.job_id),
      originalName:req.file.originalname,mimeType:req.file.mimetype,filePath:req.file.path,
      createdByUserId:req.session.user.id
    });
    await writeAudit(req,"document_created","document",result.documentId,{document_type:documentType,version:1});
    res.status(201).json({success:true,...result});
  }catch(error){
    if(req.file) await fs.promises.unlink(req.file.path).catch(()=>{});
    logError("Error subiendo documento",{requestId:req.requestId,error:error.message});
    res.status(400).json({error:error.message||"No se pudo guardar el documento."});
  }
});

app.post("/api/admin/documents/:id(\\d+)/versions", requireAdmin, adminMutationLimiter, documentUpload.single("file"), async(req,res)=>{
  try{
    if(!req.file) return res.status(400).json({error:"Seleccioná un archivo."});
    const result=await createDocumentVersion(req.params.id,req.file,req.session.user.id);
    await writeAudit(req,"document_version_created","document",Number(req.params.id),{version:result.version});
    res.status(201).json({success:true,...result});
  }catch(error){
    if(req.file) await fs.promises.unlink(req.file.path).catch(()=>{});
    res.status(400).json({error:error.message||"No se pudo crear la versión."});
  }
});

app.post("/api/admin/documents/from-quote/:quoteId(\\d+)", requireAdmin, adminMutationLimiter, async(req,res)=>{
  try{
    const quoteId=validateDocumentEntityId(req.params.quoteId);
    if(!quoteId) return res.status(400).json({error:"ID de presupuesto inválido."});
    const quote=await getQuoteDetail(pool,quoteId);
    if(!quote) return res.status(404).json({error:"Presupuesto no encontrado."});
    const pdf=await pdfToBuffer(buildQuotePdf(quote));
    const result=await createGeneratedPdfDocument({
      title:"Presupuesto "+(quote.quote_number||quoteId),
      type:"quote_pdf",pdf,
      clientId:quote.client_id||null,quoteRequestId:quote.quote_request_id||null,quoteId,
      userId:req.session.user.id,fileName:`presupuesto-${quote.quote_number||quoteId}.pdf`
    });
    await writeAudit(req,"quote_document_generated","document",result.documentId,{quote_id:quoteId});
    res.status(201).json({success:true,...result});
  }catch(error){logError("Error generando documento de presupuesto",{requestId:req.requestId,error:error.message});res.status(500).json({error:"No se pudo generar el PDF del presupuesto."});}
});

app.post("/api/admin/documents/from-job/:jobId(\\d+)", requireAdmin, adminMutationLimiter, async(req,res)=>{
  try{
    const jobId=validateDocumentEntityId(req.params.jobId);
    if(!jobId) return res.status(400).json({error:"ID de trabajo inválido."});
    const [rows]=await pool.query(
      `SELECT j.*,qr.name AS client_name,qr.phone AS client_phone,qr.service,qu.quote_number,
        u.name AS technician_name,c.id AS client_id
       FROM jobs j
       LEFT JOIN quote_requests qr ON qr.id=j.quote_request_id
       LEFT JOIN quotes qu ON qu.id=j.quote_id
       LEFT JOIN clients c ON c.id=qr.client_id
       LEFT JOIN users u ON u.id=j.assigned_user_id
       WHERE j.id=? LIMIT 1`,[jobId]);
    if(!rows.length) return res.status(404).json({error:"Trabajo no encontrado."});
    const type=String(req.body.type||"job_report")==="work_completion"?"work_completion":"job_report";
    const pdf=await buildJobDocumentPdf(rows[0],type);
    const result=await createGeneratedPdfDocument({
      title:(type==="work_completion"?"Constancia de trabajo #":"Informe de trabajo #")+jobId,
      type,pdf,clientId:rows[0].client_id||null,quoteRequestId:rows[0].quote_request_id||null,quoteId:rows[0].quote_id||null,jobId,
      userId:req.session.user.id,fileName:`${type}-${jobId}.pdf`
    });
    await writeAudit(req,"job_document_generated","document",result.documentId,{job_id:jobId,type});
    res.status(201).json({success:true,...result});
  }catch(error){logError("Error generando documento de trabajo",{requestId:req.requestId,error:error.message});res.status(500).json({error:"No se pudo generar el documento del trabajo."});}
});

app.delete("/api/admin/documents/:id(\\d+)", requireAdmin, adminMutationLimiter, async(req,res)=>{
  const connection=await pool.getConnection();
  try{
    const id=validateDocumentEntityId(req.params.id);
    if(!id){connection.release();return res.status(400).json({error:"ID de documento inválido."});}
    const [versions]=await connection.query("SELECT stored_name FROM document_versions WHERE document_id=?",[id]);
    const [result]=await connection.query("DELETE FROM documents WHERE id=?",[id]);
    if(!result.affectedRows){connection.release();return res.status(404).json({error:"Documento no encontrado."});}
    await connection.commit().catch(()=>{});
    connection.release();
    for(const row of versions){const p=documentAbsolutePath(row.stored_name);if(p) await fs.promises.unlink(p).catch(()=>{});}
    await writeAudit(req,"document_deleted","document",id,{versions:versions.length});
    res.json({success:true,message:"Documento eliminado."});
  }catch(error){await connection.rollback().catch(()=>{});connection.release();res.status(500).json({error:"No se pudo eliminar el documento."});}
});

app.get("/api/admin/documents/:id(\\d+)/versions", requireAdmin, async(req,res)=>{
  try{
    const id=validateDocumentEntityId(req.params.id);
    if(!id) return res.status(400).json({error:"ID de documento inválido."});
    const [rows]=await pool.query(
      `SELECT v.*,u.name AS created_by_name FROM document_versions v LEFT JOIN users u ON u.id=v.created_by_user_id WHERE v.document_id=? ORDER BY v.version_number DESC`,[id]);
    res.json(rows);
  }catch(error){res.status(500).json({error:"No se pudieron obtener las versiones."});}
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