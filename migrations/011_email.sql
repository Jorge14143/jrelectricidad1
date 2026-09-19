-- =========================================================
-- FASE 12 — EMAIL TRANSACCIONAL / OUTBOX
-- =========================================================

CREATE TABLE IF NOT EXISTS email_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  to_email VARCHAR(190) NOT NULL,
  cc_email VARCHAR(500) NULL,
  bcc_email VARCHAR(500) NULL,
  subject VARCHAR(255) NOT NULL,
  template VARCHAR(80) NOT NULL,
  payload JSON NULL,
  status ENUM('queued','sending','sent','failed','skipped') NOT NULL DEFAULT 'queued',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 5,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  last_error VARCHAR(1000) NULL,
  provider_message_id VARCHAR(255) NULL,
  request_id VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_email_outbox_queue (status, next_attempt_at, id),
  KEY idx_email_outbox_recipient (to_email, created_at),
  KEY idx_email_outbox_template (template, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
