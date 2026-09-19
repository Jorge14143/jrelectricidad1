-- JR ELECTRICIDAD V3 — BLOQUE I: WHATSAPP Y COMUNICACIONES
-- Se usa WhatsApp mediante enlaces oficiales wa.me.
-- No almacena credenciales de WhatsApp ni implementa venta de productos.

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id int unsigned NOT NULL AUTO_INCREMENT,
  name varchar(120) NOT NULL,
  event_key varchar(80) NOT NULL,
  body text NOT NULL,
  active tinyint(1) NOT NULL DEFAULT 1,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_template_event_name (event_key,name),
  KEY idx_whatsapp_template_event_active (event_key,active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  template_id int unsigned DEFAULT NULL,
  event_key varchar(80) NOT NULL,
  recipient_name varchar(180) DEFAULT '',
  recipient_phone varchar(50) NOT NULL,
  message_text text NOT NULL,
  target_type varchar(50) DEFAULT '',
  target_id bigint unsigned DEFAULT NULL,
  status enum('prepared','opened','sent','failed') NOT NULL DEFAULT 'prepared',
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  opened_at timestamp NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_whatsapp_messages_created (created_at),
  KEY idx_whatsapp_messages_target (target_type,target_id),
  KEY idx_whatsapp_messages_phone (recipient_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO whatsapp_templates (name,event_key,body) VALUES
('Presupuesto enviado','quote_sent','Hola {cliente}, te enviamos tu presupuesto {presupuesto} de JR Electricidad. Total: {total}. Podés consultarlo desde: {url}'),
('Presupuesto aceptado','quote_accepted','Hola {cliente}, recibimos la aceptación del presupuesto {presupuesto}. Gracias por confiar en JR Electricidad.'),
('Presupuesto rechazado','quote_rejected','Hola {cliente}, registramos el rechazo del presupuesto {presupuesto}. Si necesitás revisar el servicio, estamos a disposición.'),
('Recordatorio de turno','appointment_reminder','Hola {cliente}, te recordamos tu turno con JR Electricidad para {fecha} a las {hora}.'),
('Aviso de trabajo','job_notice','Hola {cliente}, tenemos una actualización sobre tu trabajo {trabajo}: {detalle}.'),
('Aviso de pago','payment_notice','Hola {cliente}, registramos una actualización de pago del servicio {presupuesto}: {detalle}.');
