-- JR ELECTRICIDAD V3 — BLOQUE K: FIRMA DIGITAL
-- Registro de firmas electrónicas asociadas a presupuestos/documentos.
-- La firma se almacena como evidencia técnica de aceptación/consentimiento.

CREATE TABLE IF NOT EXISTS digital_signatures (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_id INT DEFAULT NULL,
  document_type VARCHAR(60) NOT NULL DEFAULT 'quote',
  document_id BIGINT UNSIGNED DEFAULT NULL,
  signer_name VARCHAR(150) NOT NULL,
  signer_email VARCHAR(190) DEFAULT NULL,
  signature_data LONGTEXT NOT NULL,
  signed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(500) DEFAULT NULL,
  evidence_hash CHAR(64) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_signature_quote (quote_id),
  KEY idx_signature_document (document_type, document_id),
  KEY idx_signature_date (signed_at),
  UNIQUE KEY uq_signature_quote_type (quote_id, document_type),
  CONSTRAINT fk_signature_quote
    FOREIGN KEY (quote_id) REFERENCES quotes(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
