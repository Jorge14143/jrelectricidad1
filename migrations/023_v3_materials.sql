-- JR ELECTRICIDAD V3 — BLOQUE H: MATERIALES TÉCNICOS
-- Los materiales son información técnica para ejecutar trabajos.
-- NO contienen precio, stock, proveedor, compra ni venta.

CREATE TABLE IF NOT EXISTS material_categories (
  id int unsigned NOT NULL AUTO_INCREMENT,
  name varchar(100) NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_material_category_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS material_units (
  id int unsigned NOT NULL AUTO_INCREMENT,
  name varchar(50) NOT NULL,
  symbol varchar(20) NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_material_unit_name (name),
  UNIQUE KEY uq_material_unit_symbol (symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS materials (
  id int unsigned NOT NULL AUTO_INCREMENT,
  name varchar(180) NOT NULL,
  description varchar(500) DEFAULT NULL,
  category_id int unsigned DEFAULT NULL,
  unit_id int unsigned NOT NULL,
  active tinyint(1) NOT NULL DEFAULT 1,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_material_category (category_id),
  KEY idx_material_unit (unit_id),
  KEY idx_material_active_name (active,name),
  CONSTRAINT fk_material_category FOREIGN KEY (category_id) REFERENCES material_categories(id) ON DELETE SET NULL,
  CONSTRAINT fk_material_unit FOREIGN KEY (unit_id) REFERENCES material_units(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quote_materials (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  quote_id int NOT NULL,
  material_id int unsigned NOT NULL,
  quantity decimal(12,3) NOT NULL DEFAULT 1.000,
  notes varchar(500) DEFAULT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_quote_material (quote_id,material_id),
  KEY idx_quote_material_quote (quote_id),
  KEY idx_quote_material_material (material_id),
  CONSTRAINT fk_quote_material_quote FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
  CONSTRAINT fk_quote_material_material FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO material_categories (name) VALUES
('Conductores'),('Protecciones'),('Canalización'),('Cajas y accesorios'),('Iluminación'),('Conexiones'),('Herramientas y consumibles'),('Otros');

INSERT IGNORE INTO material_units (name,symbol) VALUES
('Unidad','un'),('Metro','m'),('Rollo','rollo'),('Juego','juego'),('Caja','caja'),('Par','par');
