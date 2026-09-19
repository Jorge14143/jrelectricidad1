"use strict";

const crypto = require("crypto");

let pool = null;
let timer = null;
let processing = false;
const RETRY_DELAYS = [1,5,15,60,240];

function normalizeWhatsAppNumber(value) {
  let raw = String(value || "").trim();
  if (!raw) return "";
  raw = raw.replace(/[^0-9+]/g, "");
  if (raw.startsWith("+")) raw = raw.slice(1);
  if (raw.startsWith("00")) raw = raw.slice(2);
  if (raw.startsWith("0") && !raw.startsWith("00")) raw = raw.slice(1);
  if (/^15d{8}$/.test(raw)) raw = "9" + raw.slice(2);
  if (/^d{10}$/.test(raw)) raw = "54" + raw;
  return /^d{10,15}$/.test(raw) ? raw : "";
}

function buildWhatsAppLink(phone, message = "") {
  const number = normalizeWhatsAppNumber(phone);
  if (!number) return null;
  const text = String(message || "").slice(0, 4000);
  return "https://wa.me/" + number + (text ? "?text=" + encodeURIComponent(text) : "");
}

function providerConfigured() {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_PHONE_NUMBER_ID
  );
}

function apiVersion() {
  return String(process.env.WHATSAPP_API_VERSION || "v23.0");
}

async function sendProviderMessage(phone, message) {
  if (!providerConfigured()) throw new Error("WhatsApp Cloud API no configurada.");
  const number = normalizeWhatsAppNumber(phone);
  if (!number) throw new Error("Número de WhatsApp inválido.");

  const response = await fetch(
    "https://graph.facebook.com/" + apiVersion() + "/" +
    encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID) + "/messages",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.WHATSAPP_ACCESS_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: number,
        type: "text",
        text: { preview_url: true, body: String(message).slice(0, 4096) }
      })
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      String(data?.error?.message || "WhatsApp API devolvió un error.").slice(0, 900)
    );
  }

  return data?.messages?.[0]?.id || null;
}

async function configureWhatsAppService(db) {
  pool = db;
  if (timer) return;
  timer = setInterval(() => processWhatsAppQueue().catch(() => {}), 30000);
  if (timer.unref) timer.unref();
  setTimeout(() => processWhatsAppQueue().catch(() => {}), 2000).unref?.();
}

async function queueWhatsApp({to,message,requestId=null,entityType=null,entityId=null,maxAttempts=5}) {
  if (!pool) throw new Error("Servicio de WhatsApp no inicializado.");
  const phone = normalizeWhatsAppNumber(to);
  if (!phone) throw new Error("Número de WhatsApp inválido.");
  const body = String(message || "").trim().slice(0,4096);
  if (!body) throw new Error("El mensaje de WhatsApp no puede estar vacío.");

  const [result] = await pool.query(
    `INSERT INTO whatsapp_outbox
      (to_phone,message,message_type,max_attempts,next_attempt_at,request_id,entity_type,entity_id)
     VALUES (?,?, 'text', ?, NOW(), ?, ?, ?)`,
    [phone,body,Math.min(Math.max(Number(maxAttempts)||5,1),10),requestId,entityType,entityId == null ? null : Number(entityId)]
  );
  processWhatsAppQueue().catch(() => {});
  return {queued:true,id:result.insertId,phone,link:buildWhatsAppLink(phone,body)};
}

async function claimWhatsApp() {
  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]=await connection.query(
      `SELECT * FROM whatsapp_outbox
       WHERE status='queued' AND next_attempt_at<=NOW()
       ORDER BY id ASC LIMIT 1 FOR UPDATE`
    );
    if(!rows.length){await connection.rollback();return null;}
    const row=rows[0];
    await connection.query(
      "UPDATE whatsapp_outbox SET status='sending',attempts=attempts+1 WHERE id=? AND status='queued'",
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
  if (!providerConfigured()) {
    await pool.query(
      "UPDATE whatsapp_outbox SET status='skipped',last_error=? WHERE id=?",
      ["WhatsApp Cloud API no configurada.",row.id]
    );
    return;
  }
  try {
    const providerId=await sendProviderMessage(row.to_phone,row.message);
    await pool.query(
      "UPDATE whatsapp_outbox SET status='sent',sent_at=NOW(),last_error=NULL,provider_message_id=? WHERE id=?",
      [providerId,row.id]
    );
  } catch(error) {
    const attempts=Number(row.attempts||0);
    const max=Number(row.max_attempts||5);
    if(attempts>=max){
      await pool.query(
        "UPDATE whatsapp_outbox SET status='failed',last_error=? WHERE id=?",
        [String(error.message||"Error WhatsApp").slice(0,1000),row.id]
      );
    } else {
      const delay=RETRY_DELAYS[Math.min(Math.max(attempts-1,0),RETRY_DELAYS.length-1)];
      await pool.query(
        "UPDATE whatsapp_outbox SET status='queued',next_attempt_at=DATE_ADD(NOW(),INTERVAL ? MINUTE),last_error=? WHERE id=?",
        [delay,String(error.message||"Error WhatsApp").slice(0,1000),row.id]
      );
    }
  }
}

async function processWhatsAppQueue() {
  if(!pool||processing)return;
  processing=true;
  try {
    await pool.query(
      "UPDATE whatsapp_outbox SET status='queued',next_attempt_at=NOW(),last_error=COALESCE(last_error,'Reintento recuperado tras reinicio del servidor.') WHERE status='sending' AND updated_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)"
    );
    for(let i=0;i<10;i++){
      const row=await claimWhatsApp();
      if(!row)break;
      await processOne(row);
    }
  } finally { processing=false; }
}

async function getWhatsAppStats() {
  const [rows]=await pool.query(
    "SELECT status,COUNT(*) AS total,MAX(created_at) AS last_created,MAX(sent_at) AS last_sent FROM whatsapp_outbox GROUP BY status"
  );
  return rows;
}

module.exports={
  configureWhatsAppService,
  queueWhatsApp,
  processWhatsAppQueue,
  getWhatsAppStats,
  normalizeWhatsAppNumber,
  buildWhatsAppLink,
  providerConfigured
};
