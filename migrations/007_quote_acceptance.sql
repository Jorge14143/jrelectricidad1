-- V2 Fase 7: aceptación digital de presupuestos
CREATE TABLE IF NOT EXISTS quote_acceptances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_id INT NOT NULL,
  decision ENUM('aceptado','rechazado') NOT NULL,
  customer_name VARCHAR(150) NOT NULL,
  customer_email VARCHAR(190) NOT NULL,
  customer_phone VARCHAR(50) NOT NULL,
  customer_note TEXT NULL,
  consent_text TEXT NULL,
  signature_name VARCHAR(150) NOT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(512) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_quote_acceptance_quote_created (quote_id, created_at),
  KEY idx_quote_acceptance_decision_created (decision, created_at),
  CONSTRAINT fk_quote_acceptance_quote
    FOREIGN KEY (quote_id) REFERENCES quotes(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
