-- V2 FASE 6 — PRESUPUESTOS AVANZADOS

ALTER TABLE quotes
  ADD COLUMN sent_at DATETIME NULL,
  ADD COLUMN accepted_at DATETIME NULL,
  ADD COLUMN rejected_at DATETIME NULL,
  ADD COLUMN viewed_at DATETIME NULL,
  ADD KEY idx_quotes_status_created (status, created_at),
  ADD KEY idx_quotes_request_status (quote_request_id, status);

CREATE TABLE IF NOT EXISTS quote_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_id INT NOT NULL,
  actor_user_id INT NULL,
  action VARCHAR(80) NOT NULL,
  old_status VARCHAR(30) NULL,
  new_status VARCHAR(30) NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_quote_history_quote_created (quote_id, created_at),
  KEY idx_quote_history_actor_created (actor_user_id, created_at),
  CONSTRAINT fk_quote_history_quote
    FOREIGN KEY (quote_id) REFERENCES quotes(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_quote_history_actor
    FOREIGN KEY (actor_user_id) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
