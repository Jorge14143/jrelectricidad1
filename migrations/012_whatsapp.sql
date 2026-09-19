-- =========================================================
-- FASE 13 — WHATSAPP
-- =========================================================

ALTER TABLE business_settings
  ADD COLUMN whatsapp_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN whatsapp_auto_notifications TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  to_phone VARCHAR(30) NOT NULL,
  message TEXT NOT NULL,
  message_type VARCHAR(50) NOT NULL DEFAULT 'text',
  status ENUM('queued','sending','sent','failed','skipped') NOT NULL DEFAULT 'queued',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 5,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  last_error VARCHAR(1000) NULL,
  provider_message_id VARCHAR(255) NULL,
  request_id VARCHAR(100) NULL,
  entity_type VARCHAR(50) NULL,
  entity_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_whatsapp_queue (status, next_attempt_at, id),
  KEY idx_whatsapp_recipient (to_phone, created_at),
  KEY idx_whatsapp_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
