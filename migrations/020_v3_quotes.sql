-- V3 BLOCK E — PRESUPUESTOS V3
CREATE TABLE IF NOT EXISTS v3_quote_versions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 quote_id INT NOT NULL,
 version_no INT NOT NULL,
 snapshot JSON NOT NULL,
 created_by INT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(id),
 UNIQUE KEY uq_v3_quote_version(quote_id,version_no),
 KEY idx_v3_quote_versions_quote(quote_id,created_at),
 CONSTRAINT fk_v3_qv_quote FOREIGN KEY(quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
 CONSTRAINT fk_v3_qv_user FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS v3_quote_events (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 quote_id INT NOT NULL,
 actor_user_id INT NULL,
 event_type VARCHAR(50) NOT NULL,
 metadata JSON NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(id),
 KEY idx_v3_qe_quote_created(quote_id,created_at),
 KEY idx_v3_qe_type_created(event_type,created_at),
 CONSTRAINT fk_v3_qe_quote FOREIGN KEY(quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
 CONSTRAINT fk_v3_qe_user FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS v3_quote_templates (
 id INT UNSIGNED NOT NULL AUTO_INCREMENT,
 name VARCHAR(120) NOT NULL,
 description VARCHAR(500) NULL,
 default_valid_days INT NOT NULL DEFAULT 15,
 default_discount DECIMAL(12,2) NOT NULL DEFAULT 0,
 terms TEXT NULL,
 active TINYINT(1) NOT NULL DEFAULT 1,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO v3_quote_templates(name,description,default_valid_days,terms)
SELECT 'Presupuesto estándar','Plantilla general JR Electricidad',15,'Presupuesto sujeto a las condiciones indicadas. La aceptación autoriza la coordinación del trabajo.'
WHERE NOT EXISTS (SELECT 1 FROM v3_quote_templates LIMIT 1);

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(6,3) NOT NULL DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS public_note TEXT NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS version_no INT NOT NULL DEFAULT 1;
