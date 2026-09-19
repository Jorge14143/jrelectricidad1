-- =========================================================
-- FASE 9 — GALERÍA AVANZADA
-- =========================================================

ALTER TABLE gallery
  ADD COLUMN alt_text VARCHAR(255) NULL,
  ADD COLUMN category VARCHAR(40) NOT NULL DEFAULT 'otros',
  ADD COLUMN client_id INT UNSIGNED NULL,
  ADD COLUMN job_id INT NULL,
  ADD COLUMN quote_id INT NULL,
  ADD COLUMN source_job_attachment_id BIGINT UNSIGNED NULL,
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ADD KEY idx_gallery_active_featured_order (active, featured, sort_order),
  ADD KEY idx_gallery_category_active (category, active),
  ADD KEY idx_gallery_client (client_id),
  ADD KEY idx_gallery_job (job_id),
  ADD KEY idx_gallery_quote (quote_id),
  ADD KEY idx_gallery_source_attachment (source_job_attachment_id);

UPDATE gallery
SET
  alt_text = COALESCE(NULLIF(TRIM(alt_text), ''), title),
  category = CASE
    WHEN LOWER(title) LIKE '%tablero%' THEN 'tableros'
    WHEN LOWER(title) LIKE '%ilumin%' OR LOWER(title) LIKE '%luz%' THEN 'iluminacion'
    WHEN LOWER(title) LIKE '%repar%' THEN 'reparaciones'
    WHEN LOWER(title) LIKE '%mantenimiento%' THEN 'mantenimiento'
    WHEN LOWER(title) LIKE '%instal%' THEN 'instalaciones'
    ELSE 'otros'
  END;

ALTER TABLE gallery
  MODIFY alt_text VARCHAR(255) NOT NULL;

ALTER TABLE gallery
  ADD CONSTRAINT fk_gallery_client
    FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT fk_gallery_job
    FOREIGN KEY (job_id) REFERENCES jobs(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT fk_gallery_quote
    FOREIGN KEY (quote_id) REFERENCES quotes(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT fk_gallery_source_attachment
    FOREIGN KEY (source_job_attachment_id) REFERENCES job_attachments(id)
    ON DELETE SET NULL;
