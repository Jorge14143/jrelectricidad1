-- V2 FASE 4 — CLIENTES
CREATE TABLE IF NOT EXISTS clients (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NULL,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  whatsapp VARCHAR(50) NULL,
  email VARCHAR(190) NULL,
  address VARCHAR(255) NULL,
  locality VARCHAR(120) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_clients_phone (phone),
  KEY idx_clients_email (email),
  KEY idx_clients_name (name),
  CONSTRAINT fk_clients_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE quote_requests
  ADD COLUMN client_id INT UNSIGNED NULL,
  ADD KEY idx_quote_requests_client (client_id),
  ADD CONSTRAINT fk_quote_requests_client
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

INSERT INTO clients (name, phone, email, created_at, updated_at)
SELECT
  MAX(TRIM(name)),
  TRIM(phone),
  MAX(NULLIF(LOWER(TRIM(email)), '')),
  MIN(created_at),
  MAX(created_at)
FROM quote_requests
WHERE TRIM(phone) <> ''
GROUP BY TRIM(phone);

UPDATE quote_requests qr
JOIN clients c ON c.phone = TRIM(qr.phone)
SET qr.client_id = c.id
WHERE qr.client_id IS NULL;
