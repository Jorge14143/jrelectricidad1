"use strict";

const nodemailer = require("nodemailer");
const crypto = require("crypto");

let pool = null;
let timer = null;
let processing = false;

const RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 240];

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD &&
    process.env.MAIL_FROM
  );
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function layout(title, body) {
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#080a0f;color:#f5f7fb;font-family:Arial,sans-serif">
<div style="max-width:640px;margin:0 auto;padding:32px 20px">
<div style="background:#10141c;border:1px solid #202733;border-radius:14px;padding:28px">
<h2 style="margin-top:0;color:#ffc400">JR Electricidad ⚡</h2>
${body}
</div>
<p style="color:#9ca6b5;font-size:12px;text-align:center;margin-top:18px">Electricista Matriculado Cat. 3</p>
</div></body></html>`;
}

function renderTemplate(template, data = {}) {
  switch (template) {
    case "password_reset":
      return {
        subjectFallback: "Recuperación de contraseña - JR Electricidad",
        html: layout("Recuperación de contraseña", `
<h3>Recuperación de contraseña</h3>
<p>Recibimos una solicitud para cambiar tu contraseña.</p>
<p><a href="${escapeHtml(data.link)}" style="display:inline-block;padding:12px 18px;background:#ffc400;color:#080a0f;text-decoration:none;border-radius:8px;font-weight:bold">Restablecer contraseña</a></p>
<p>Este enlace vence en ${Number(data.minutes || 30)} minutos.</p>
<p>Si no solicitaste este cambio, podés ignorar este correo.</p>`)
      };
    case "generic_account":
      return {
        subjectFallback: "Cuenta - JR Electricidad",
        html: layout(data.title || "Cuenta", `
<h3>${escapeHtml(data.title || "Actualización de cuenta")}</h3>
<p>${escapeHtml(data.text || "")}</p>
${data.link ? `<p><a href="${escapeHtml(data.link)}" style="display:inline-block;padding:12px 18px;background:#ffc400;color:#080a0f;text-decoration:none;border-radius:8px;font-weight:bold">${escapeHtml(data.linkLabel || "Continuar")}</a></p>` : ""}
${data.link ? `<p>Este enlace vence en ${Number(data.minutes || 30)} minutos y solo puede utilizarse una vez.</p>` : ""}`)
      };
    case "quote_sent":
      return {
        subjectFallback: "Presupuesto " + String(data.quoteNumber || "") + " - JR Electricidad",
        html: layout("Presupuesto", `
<p>Hola ${escapeHtml(data.name || "")},</p>
<p>Tu presupuesto <strong>${escapeHtml(data.quoteNumber || "")}</strong> ya está disponible.</p>
<p><strong>Total: ${escapeHtml(data.total || "")}</strong></p>
<p><a href="${escapeHtml(data.link)}" style="display:inline-block;padding:12px 18px;background:#ffc400;color:#080a0f;text-decoration:none;border-radius:8px;font-weight:bold">Ver presupuesto</a></p>
<p>Saludos,<br>JR Electricidad · Electricista Matriculado Cat. 3</p>`)
      };
    case "quote_decision": {
      const accepted = data.decision === "aceptado";
      return {
        subjectFallback: (accepted ? "Aceptación" : "Rechazo") + " de presupuesto " + String(data.quoteNumber || "") + " - JR Electricidad",
        html: layout("Decisión de presupuesto", `
<p>Hola ${escapeHtml(data.customerName || "")},</p>
<p>Registramos correctamente tu <strong>${accepted ? "aceptación" : "rechazo"}</strong> del presupuesto <strong>${escapeHtml(data.quoteNumber || "")}</strong>.</p>
<p>Fecha: ${new Date().toLocaleString("es-AR")}</p>
<p>Este correo es una constancia de la operación registrada.</p>`)
      };
    default:
      return {
        subjectFallback: "JR Electricidad",
        html: layout("JR Electricidad", "<p>Mensaje de JR Electricidad.</p>")
      };
  }
}

function createTransporter() {
  if (!smtpConfigured()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
  });
}

async function configureEmailService(db) {
  pool = db;
  if (timer) return;
  timer = setInterval(() => {
    processEmailQueue().catch(() => {});
  }, 30000);
  if (timer.unref) timer.unref();
  setTimeout(() => processEmailQueue().catch(() => {}), 1500).unref?.();
}

async function queueEmail({to,subject,template,data={},cc=null,bcc=null,requestId=null,maxAttempts=5}) {
  if (!pool) throw new Error("Servicio de email no inicializado.");
  const recipient = String(to || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 190) {
    throw new Error("Destinatario de email inválido.");
  }
  const cleanSubject = String(subject || "").trim().slice(0,255);
  if (!cleanSubject) throw new Error("El asunto del email es obligatorio.");
  const [result] = await pool.query(
    `INSERT INTO email_outbox
      (to_email,cc_email,bcc_email,subject,template,payload,max_attempts,next_attempt_at,request_id)
     VALUES (?,?,?,?,?,?,?,NOW(),?)`,
    [recipient,cc,bcc,cleanSubject,String(template || "generic").slice(0,80),JSON.stringify(data || {}),Math.min(Math.max(Number(maxAttempts)||5,1),10),requestId]
  );
  processEmailQueue().catch(() => {});
  return {queued:true,id:result.insertId};
}

async function claimEmail() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT * FROM email_outbox
       WHERE status='queued' AND next_attempt_at<=NOW()
       ORDER BY id ASC LIMIT 1 FOR UPDATE`
    );
    if (!rows.length) {
      await connection.rollback();
      return null;
    }
    const row=rows[0];
    await connection.query(
      "UPDATE email_outbox SET status='sending',attempts=attempts+1 WHERE id=? AND status='queued'",
      [row.id]
    );
    await connection.commit();
    return row;
  } catch(error) {
    await connection.rollback().catch(()=>{});
    throw error;
  } finally {
    connection.release();
  }
}

async function processOne(row) {
  if (!smtpConfigured()) {
    await pool.query(
      "UPDATE email_outbox SET status='skipped',last_error=? WHERE id=?",
      ["SMTP no configurado.",row.id]
    );
    return;
  }
  const transporter=createTransporter();
  try {
    const payload = row.payload ? JSON.parse(row.payload) : {};
    const rendered=renderTemplate(row.template,payload);
    const info=await transporter.sendMail({
      from:process.env.MAIL_FROM,
      to:row.to_email,
      cc:row.cc_email || undefined,
      bcc:row.bcc_email || undefined,
      subject:row.subject || rendered.subjectFallback,
      html:rendered.html
    });
    await pool.query(
      "UPDATE email_outbox SET status='sent',sent_at=NOW(),last_error=NULL,provider_message_id=? WHERE id=?",
      [String(info.messageId || "").slice(0,255) || null,row.id]
    );
  } catch(error) {
    const attempts=Number(row.attempts || 0);
    const max=Number(row.max_attempts || 5);
    if(attempts >= max) {
      await pool.query(
        "UPDATE email_outbox SET status='failed',last_error=? WHERE id=?",
        [String(error.message || "Error SMTP").slice(0,1000),row.id]
      );
    } else {
      const delay=RETRY_DELAYS_MINUTES[Math.min(attempts-1,RETRY_DELAYS_MINUTES.length-1)];
      await pool.query(
        "UPDATE email_outbox SET status='queued',next_attempt_at=DATE_ADD(NOW(),INTERVAL ? MINUTE),last_error=? WHERE id=?",
        [delay,String(error.message || "Error SMTP").slice(0,1000),row.id]
      );
    }
  }
}

async function processEmailQueue() {
  if (!pool || processing) return;
  await pool.query(
    "UPDATE email_outbox SET status='queued',next_attempt_at=NOW(),last_error=COALESCE(last_error,'Reintento recuperado tras reinicio del servidor.') WHERE status='sending' AND updated_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)"
  );
  processing=true;
  try {
    for (let i=0;i<10;i++) {
      const row=await claimEmail();
      if (!row) break;
      await processOne(row);
    }
  } finally {
    processing=false;
  }
}

async function getEmailStats() {
  const [rows]=await pool.query(
    `SELECT status,COUNT(*) AS total,MAX(created_at) AS last_created,MAX(sent_at) AS last_sent
     FROM email_outbox GROUP BY status`
  );
  return rows;
}

module.exports={configureEmailService,queueEmail,processEmailQueue,getEmailStats,smtpConfigured};
