-- V2 FASE 5 — SOLICITUDES AVANZADAS

ALTER TABLE quote_requests
  MODIFY status VARCHAR(30) NOT NULL DEFAULT 'nueva',
  ADD COLUMN priority ENUM('baja','normal','alta','urgente') NOT NULL DEFAULT 'normal',
  ADD COLUMN assigned_user_id INT NULL,
  ADD COLUMN scheduled_at DATETIME NULL,
  ADD COLUMN internal_notes TEXT NULL,
  ADD COLUMN closed_at DATETIME NULL,
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ADD KEY idx_quote_requests_status_priority (status, priority, created_at),
  ADD KEY idx_quote_requests_assigned (assigned_user_id, status),
  ADD KEY idx_quote_requests_scheduled (scheduled_at);

UPDATE quote_requests SET status='nueva' WHERE status='pendiente';
UPDATE quote_requests SET status='en_revision' WHERE status='contactado';
UPDATE quote_requests SET status='presupuestada' WHERE status='presupuestado';
UPDATE quote_requests SET status='cerrada', closed_at=COALESCE(closed_at, created_at) WHERE status='cerrado';

ALTER TABLE quote_requests
  ADD CONSTRAINT fk_quote_requests_assigned_user
  FOREIGN KEY (assigned_user_id) REFERENCES users(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS quote_request_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_request_id INT NOT NULL,
  actor_user_id INT NULL,
  action VARCHAR(80) NOT NULL,
  old_status VARCHAR(30) NULL,
  new_status VARCHAR(30) NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_qr_history_request_created (quote_request_id, created_at),
  KEY idx_qr_history_actor (actor_user_id, created_at),
  CONSTRAINT fk_qr_history_request
    FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_qr_history_actor
    FOREIGN KEY (actor_user_id) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quote_request_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_request_id INT NOT NULL,
  uploaded_by_user_id INT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  url VARCHAR(500) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_qr_attachment_request (quote_request_id, created_at),
  CONSTRAINT fk_qr_attachment_request
    FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_qr_attachment_user
    FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE admin_notifications
  MODIFY type ENUM(
    'quote_accepted',
    'quote_rejected',
    'quote_request_created',
    'quote_request_status',
    'job_started',
    'job_closed'
  ) NOT NULL;
