-- JR Electricidad V3 — Evidencia y Multimedia
CREATE TABLE IF NOT EXISTS job_evidence (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 job_id INT UNSIGNED NOT NULL,
 quote_id INT UNSIGNED NULL,
 evidence_type ENUM('general','before','after','document') NOT NULL DEFAULT 'general',
 title VARCHAR(180) NOT NULL,
 description VARCHAR(1000) DEFAULT '',
 file_url VARCHAR(500) NOT NULL,
 original_name VARCHAR(255) NOT NULL,
 mime_type VARCHAR(100) NOT NULL,
 file_size INT UNSIGNED NOT NULL DEFAULT 0,
 sort_order INT NOT NULL DEFAULT 0,
 created_by INT UNSIGNED NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_job_evidence_job(job_id, evidence_type, sort_order),
 INDEX idx_job_evidence_quote(quote_id),
 CONSTRAINT fk_job_evidence_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
 CONSTRAINT fk_job_evidence_quote FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;