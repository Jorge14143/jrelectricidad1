-- =========================================================
-- JR ELECTRICIDAD V3 — BLOCK G: FINANZAS
-- Servicios solamente. NO venta de materiales.
-- =========================================================

CREATE TABLE IF NOT EXISTS service_invoices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_id INT NOT NULL,
  invoice_number VARCHAR(40) NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE DEFAULT NULL,
  total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status ENUM('emitida','parcial','pagada','vencida','anulada') NOT NULL DEFAULT 'emitida',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_invoice_quote (quote_id),
  UNIQUE KEY uq_service_invoice_number (invoice_number),
  KEY idx_service_invoice_date (issue_date),
  KEY idx_service_invoice_status (status),
  CONSTRAINT fk_service_invoice_quote
    FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS service_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  payment_date DATE NOT NULL,
  method ENUM('efectivo','transferencia','tarjeta','otro') NOT NULL DEFAULT 'otro',
  reference VARCHAR(150) DEFAULT NULL,
  notes VARCHAR(1000) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_service_payment_invoice (invoice_id),
  KEY idx_service_payment_date (payment_date),
  CONSTRAINT fk_service_payment_invoice
    FOREIGN KEY (invoice_id) REFERENCES service_invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_expenses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  expense_date DATE NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'general',
  description VARCHAR(500) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  notes VARCHAR(1000) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_business_expense_date (expense_date),
  KEY idx_business_expense_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill: presupuestos ya aceptados/cerrados pasan a registro de facturación
-- de servicio. No se crean registros de materiales ni productos.
INSERT INTO service_invoices
  (quote_id, invoice_number, issue_date, total, status, notes)
SELECT
  q.id,
  CONCAT('SRV-', YEAR(COALESCE(q.issue_date, CURDATE())), '-', LPAD(q.id, 6, '0')),
  COALESCE(q.issue_date, CURDATE()),
  q.total,
  'emitida',
  'Registro automático por presupuesto aceptado/cerrado.'
FROM quotes q
LEFT JOIN service_invoices i ON i.quote_id = q.id
WHERE q.status IN ('aceptado','cerrado')
  AND i.id IS NULL;

-- El cambio de presupuesto aceptado/cerrado a facturación se controla desde
-- la aplicación. Esto evita mezclar lógica comercial de materiales con finanzas.
