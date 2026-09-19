CREATE TABLE IF NOT EXISTS v3_testimonials (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_name VARCHAR(120) NOT NULL,
  client_location VARCHAR(120) NULL,
  rating TINYINT UNSIGNED NOT NULL DEFAULT 5,
  message VARCHAR(1000) NOT NULL,
  approved TINYINT(1) NOT NULL DEFAULT 0,
  featured TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_v3_testimonials_public (approved, featured, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS v3_appointments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(190) NULL,
  service VARCHAR(150) NULL,
  notes VARCHAR(1000) NULL,
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status ENUM('pending','confirmed','cancelled','completed') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_v3_appointments_date_status (appointment_date, status),
  UNIQUE KEY uq_v3_appointments_slot (appointment_date, start_time, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE v3_system
  ADD COLUMN IF NOT EXISTS appointment_enabled TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS appointment_start_hour TINYINT UNSIGNED NOT NULL DEFAULT 9,
  ADD COLUMN IF NOT EXISTS appointment_end_hour TINYINT UNSIGNED NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS appointment_slot_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60;