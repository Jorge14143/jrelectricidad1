-- Fase 18 — Backups
CREATE TABLE IF NOT EXISTS backups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  filename VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  backup_type VARCHAR(40) NOT NULL DEFAULT 'database',
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  sha256 CHAR(64) NULL,
  status ENUM('running','completed','failed','deleted') NOT NULL DEFAULT 'running',
  created_by_user_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  error_message VARCHAR(1000) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_backups_filename (filename),
  KEY idx_backups_created (created_at, id),
  KEY idx_backups_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;