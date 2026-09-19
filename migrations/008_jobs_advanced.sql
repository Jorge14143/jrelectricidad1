-- =========================================================
-- FASE 8 — TRABAJOS AVANZADOS
-- =========================================================

ALTER TABLE jobs
  ADD COLUMN assigned_user_id INT NULL,
  ADD COLUMN scheduled_at DATETIME NULL,
  ADD COLUMN internal_notes TEXT NULL,
  ADD COLUMN execution_notes TEXT NULL,
  ADD COLUMN completion_notes TEXT NULL,
  ADD COLUMN location VARCHAR(255) NULL,
  ADD COLUMN started_by_user_id INT NULL,
  ADD COLUMN completed_by_user_id INT NULL,
  ADD KEY idx_jobs_assigned_scheduled (assigned_user_id, scheduled_at),
  ADD KEY idx_jobs_status_scheduled (status, scheduled_at);

CREATE TABLE IF NOT EXISTS job_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id INT NOT NULL,
  actor_user_id INT NULL,
  action VARCHAR(80) NOT NULL,
  old_status VARCHAR(40) NULL,
  new_status VARCHAR(40) NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_job_history_job_created (job_id, created_at),
  KEY idx_job_history_actor_created (actor_user_id, created_at),
  CONSTRAINT fk_job_history_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_job_history_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id INT NOT NULL,
  uploaded_by_user_id INT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  url VARCHAR(500) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  category ENUM('inicio','proceso','final','documento','otro') NOT NULL DEFAULT 'otro',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_job_attachments_job_created (job_id, created_at),
  CONSTRAINT fk_job_attachments_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_job_attachments_user FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
