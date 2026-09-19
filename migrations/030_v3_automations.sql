-- JR Electricidad V3 — Automatizaciones
CREATE TABLE IF NOT EXISTS automation_rules (
 id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(150) NOT NULL,
 event_key VARCHAR(100) NOT NULL,
 action_type ENUM('notification','email','whatsapp') NOT NULL,
 delay_minutes INT NOT NULL DEFAULT 0,
 active TINYINT(1) NOT NULL DEFAULT 1,
 config JSON NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX idx_automation_event_active(event_key,active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_logs (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 rule_id INT UNSIGNED NULL,
 event_key VARCHAR(100) NOT NULL,
 target_type VARCHAR(50) NULL,
 target_id INT NULL,
 status ENUM('executed','skipped','failed') NOT NULL,
 message VARCHAR(1000) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_automation_logs_created(created_at),
 INDEX idx_automation_logs_event(event_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO automation_rules(name,event_key,action_type,delay_minutes,active,config) VALUES
('Notificar presupuesto aceptado','quote_accepted','notification',0,1,'{}'),
('Notificar presupuesto rechazado','quote_rejected','notification',0,1,'{}'),
('Avisar trabajo iniciado','job_started','notification',0,1,'{}'),
('Avisar trabajo cerrado','job_closed','notification',0,1,'{}'),
('Registrar aviso de cobro','payment_received','notification',0,1,'{}'),
('Recordatorio de presupuestos próximos a vencer','quote_expiring','notification',1440,1,'{}'),
('Recordatorio de facturas vencidas','invoice_overdue','notification',1440,1,'{}')
ON DUPLICATE KEY UPDATE name=VALUES(name);