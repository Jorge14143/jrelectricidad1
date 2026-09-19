-- V3 Block F — Gestión de Trabajos
CREATE TABLE IF NOT EXISTS v3_job_events (
  id INT NOT NULL AUTO_INCREMENT,
  job_id INT NOT NULL,
  actor_user_id INT NULL,
  event_type VARCHAR(60) NOT NULL,
  old_status VARCHAR(40) NULL,
  new_status VARCHAR(40) NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_v3_job_events_job_created (job_id,created_at),
  CONSTRAINT fk_v3_job_events_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS v3_job_tasks (
  id INT NOT NULL AUTO_INCREMENT,
  job_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  completed TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  completed_at DATETIME NULL,
  completed_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_v3_job_tasks_job (job_id,sort_order),
  CONSTRAINT fk_v3_job_tasks_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS v3_job_costs (
  id INT NOT NULL AUTO_INCREMENT,
  job_id INT NOT NULL,
  kind ENUM('material','labor','other') NOT NULL DEFAULT 'material',
  description VARCHAR(255) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_v3_job_costs_job (job_id),
  CONSTRAINT fk_v3_job_costs_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS v3_job_notes (
  id INT NOT NULL AUTO_INCREMENT,
  job_id INT NOT NULL,
  user_id INT NULL,
  note TEXT NOT NULL,
  visibility ENUM('internal','client') NOT NULL DEFAULT 'internal',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_v3_job_notes_job_created (job_id,created_at),
  CONSTRAINT fk_v3_job_notes_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS v3_job_time_entries (
  id INT NOT NULL AUTO_INCREMENT,
  job_id INT NOT NULL,
  user_id INT NULL,
  started_at DATETIME NOT NULL,
  ended_at DATETIME NULL,
  minutes INT NOT NULL DEFAULT 0,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_v3_job_time_job (job_id,started_at),
  CONSTRAINT fk_v3_job_time_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE jobs MODIFY COLUMN status VARCHAR(40) NOT NULL DEFAULT 'pendiente_presupuesto';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_id INT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assigned_user_id INT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_at DATETIME NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS location VARCHAR(255) NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS work_description TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS internal_notes TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS execution_notes TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS estimated_hours DECIMAL(8,2) NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS actual_hours DECIMAL(8,2) NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_by INT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completed_by INT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_v3_client ON jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_jobs_v3_assigned ON jobs(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_v3_scheduled ON jobs(scheduled_at);
