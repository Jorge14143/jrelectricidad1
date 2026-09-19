-- JR Electricidad V3 — General configuration
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO app_settings (setting_key,setting_value) VALUES
('quote_validity_days','15'),
('quote_default_notes',''),
('invoice_prefix','JR'),
('invoice_tax_enabled','0'),
('invoice_tax_rate','0'),
('email_enabled','1'),
('whatsapp_enabled','1'),
('theme','dark'),
('timezone','America/Argentina/Buenos_Aires')
ON DUPLICATE KEY UPDATE setting_key=VALUES(setting_key);