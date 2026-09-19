CREATE TABLE IF NOT EXISTS v3_system (
  id TINYINT UNSIGNED NOT NULL,
  version VARCHAR(20) NOT NULL,
  environment VARCHAR(30) NOT NULL DEFAULT 'development',
  api_prefix VARCHAR(50) NOT NULL DEFAULT '/api/v3',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO v3_system (id, version, environment, api_prefix)
VALUES (1, '3.0.0', 'development', '/api/v3')
ON DUPLICATE KEY UPDATE version=VALUES(version), environment=VALUES(environment), api_prefix=VALUES(api_prefix);

CREATE TABLE IF NOT EXISTS v3_api_clients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  client_key VARCHAR(64) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  last_used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_v3_api_client_key (client_key),
  KEY idx_v3_api_clients_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
