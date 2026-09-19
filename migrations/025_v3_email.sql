-- JR ELECTRICIDAD V3 — BLOQUE J: EMAIL
-- Comunicaciones por correo electrónico. Sin venta de materiales.

CREATE TABLE IF NOT EXISTS email_templates (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  event_key VARCHAR(80) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_email_template_event_name (event_key, name),
  KEY idx_email_template_event_active (event_key, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_id INT UNSIGNED DEFAULT NULL,
  event_key VARCHAR(80) NOT NULL DEFAULT 'general',
  recipient_name VARCHAR(150) DEFAULT NULL,
  recipient_email VARCHAR(190) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  target_type VARCHAR(50) DEFAULT NULL,
  target_id BIGINT UNSIGNED DEFAULT NULL,
  status ENUM('prepared','sent','failed') NOT NULL DEFAULT 'prepared',
  error_message VARCHAR(1000) DEFAULT NULL,
  sent_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_email_message_recipient (recipient_email),
  KEY idx_email_message_event (event_key),
  KEY idx_email_message_status (status),
  KEY idx_email_message_created (created_at),
  CONSTRAINT fk_email_message_template
    FOREIGN KEY (template_id) REFERENCES email_templates(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO email_templates
  (name,event_key,subject,body)
VALUES
  ('Presupuesto enviado','quote_sent',
   'Presupuesto {presupuesto} - JR Electricidad',
   'Hola {cliente},\n\nTe enviamos el presupuesto {presupuesto} por un total de {total}.\n\nPodés consultar el detalle desde: {url}\n\nSaludos,\nJR Electricidad'),
  ('Presupuesto aceptado','quote_accepted',
   'Presupuesto {presupuesto} aceptado - JR Electricidad',
   'Hola {cliente},\n\nRegistramos la aceptación del presupuesto {presupuesto}.\n\nNos pondremos en contacto para coordinar el trabajo.\n\nJR Electricidad'),
  ('Presupuesto rechazado','quote_rejected',
   'Presupuesto {presupuesto} rechazado - JR Electricidad',
   'Hola {cliente},\n\nRegistramos el rechazo del presupuesto {presupuesto}.\n\nSi necesitás realizar una nueva consulta, estamos a disposición.\n\nJR Electricidad'),
  ('Turno confirmado','appointment_confirmed',
   'Turno confirmado - JR Electricidad',
   'Hola {cliente},\n\nTu turno quedó confirmado para el {fecha} a las {hora}.\n\nDetalle: {detalle}\n\nJR Electricidad'),
  ('Aviso de trabajo','job_notice',
   'Actualización de trabajo - JR Electricidad',
   'Hola {cliente},\n\nTenemos una actualización sobre tu trabajo: {trabajo}.\n\n{detalle}\n\nJR Electricidad'),
  ('Aviso de pago','payment_notice',
   'Actualización de pago - JR Electricidad',
   'Hola {cliente},\n\nTe informamos una actualización relacionada con el pago del servicio.\n\n{detalle}\n\nJR Electricidad');
