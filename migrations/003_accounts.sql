-- V2 FASE 3 — CUENTAS Y USUARIOS
-- Email verification, secure email change, optional avatar.

ALTER TABLE users
  ADD COLUMN email_verified_at DATETIME NULL,
  ADD COLUMN pending_email VARCHAR(190) NULL,
  ADD COLUMN avatar_url VARCHAR(500) NULL;

CREATE INDEX idx_users_pending_email ON users (pending_email);

CREATE TABLE IF NOT EXISTS account_email_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  email VARCHAR(190) NOT NULL,
  purpose ENUM('verify','change') NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_account_email_token_hash (token_hash),
  KEY idx_account_email_token_user (user_id, purpose, expires_at),
  CONSTRAINT fk_account_email_token_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
