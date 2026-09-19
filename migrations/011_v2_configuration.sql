-- Fase 16 — Configuración
CREATE TABLE IF NOT EXISTS business_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  business_name VARCHAR(150) NOT NULL DEFAULT 'JR Electricidad',
  legal_name VARCHAR(180) DEFAULT '',
  phone VARCHAR(50) DEFAULT '',
  whatsapp VARCHAR(50) DEFAULT '',
  email VARCHAR(190) DEFAULT '',
  address VARCHAR(255) DEFAULT '',
  city VARCHAR(120) DEFAULT '',
  hours VARCHAR(255) DEFAULT '',
  logo_url VARCHAR(500) DEFAULT '',
  pdf_footer VARCHAR(500) DEFAULT '',
  pdf_notes TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE business_settings ADD COLUMN whatsapp_enabled TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE business_settings ADD COLUMN whatsapp_auto_notifications TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE business_settings ADD COLUMN currency_code VARCHAR(10) NOT NULL DEFAULT 'ARS';
ALTER TABLE business_settings ADD COLUMN currency_symbol VARCHAR(10) NOT NULL DEFAULT '$';
ALTER TABLE business_settings ADD COLUMN tax_enabled TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE business_settings ADD COLUMN tax_name VARCHAR(80) NOT NULL DEFAULT 'IVA';
ALTER TABLE business_settings ADD COLUMN tax_rate DECIMAL(6,3) NOT NULL DEFAULT 0;
ALTER TABLE business_settings ADD COLUMN quote_prefix VARCHAR(20) NOT NULL DEFAULT 'PR-';
ALTER TABLE business_settings ADD COLUMN quote_next_number INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE business_settings ADD COLUMN job_prefix VARCHAR(20) NOT NULL DEFAULT 'TR-';
ALTER TABLE business_settings ADD COLUMN job_next_number INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE business_settings ADD COLUMN quote_validity_days INT UNSIGNED NOT NULL DEFAULT 15;
ALTER TABLE business_settings ADD COLUMN quote_default_notes TEXT;
ALTER TABLE business_settings ADD COLUMN quote_terms TEXT;
ALTER TABLE business_settings ADD COLUMN commercial_conditions TEXT;
ALTER TABLE jobs ADD COLUMN job_number VARCHAR(40) NULL;
CREATE UNIQUE INDEX uq_jobs_job_number ON jobs(job_number);