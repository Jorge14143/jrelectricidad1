-- V3 BLOCK C — PORTAL CLIENTE
-- Fases 14-21

CREATE TABLE IF NOT EXISTS v3_client_profiles (
  user_id INT NOT NULL,
  phone VARCHAR(50) NULL,
  whatsapp VARCHAR(50) NULL,
  address VARCHAR(255) NULL,
  locality VARCHAR(120) NULL,
  notes VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_v3_client_profile_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS v3_client_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  entity_type ENUM('request','quote','job','document') NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_v3_client_link (user_id,entity_type,entity_id),
  KEY idx_v3_client_links_entity (entity_type,entity_id),
  CONSTRAINT fk_v3_client_link_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS v3_client_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  title VARCHAR(160) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  kind VARCHAR(40) NOT NULL DEFAULT 'info',
  read_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_v3_client_notifications_user (user_id,read_at,created_at),
  CONSTRAINT fk_v3_client_notification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
