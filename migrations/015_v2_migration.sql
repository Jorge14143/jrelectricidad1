-- Fase 22 — Migración V1 → V2
CREATE TABLE IF NOT EXISTS v2_migration_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_label VARCHAR(80) NOT NULL DEFAULT 'V1',
  target_label VARCHAR(80) NOT NULL DEFAULT 'V2',
  mode ENUM('dry-run','migration') NOT NULL,
  status ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  preflight_json LONGTEXT NULL,
  result_json LONGTEXT NULL,
  error_message VARCHAR(2000) NULL,
  PRIMARY KEY (id),
  KEY idx_v2_migration_runs_started (started_at, id),
  KEY idx_v2_migration_runs_status (status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
