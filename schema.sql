CREATE DATABASE IF NOT EXISTS jr_electricidad
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE jr_electricidad;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  description TEXT,
  price DECIMAL(12,2) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO services (title, description, price) VALUES
('Instalaciones eléctricas', 'Instalaciones nuevas y ampliaciones residenciales y comerciales.', NULL),
('Reparaciones eléctricas', 'Diagnóstico y reparación de fallas eléctricas.', NULL),
('Tableros eléctricos', 'Armado, renovación y mantenimiento de tableros.', NULL),
('Iluminación', 'Instalación de luminarias, llaves, sensores y circuitos.', NULL),
('Mantenimiento', 'Mantenimiento preventivo y correctivo de instalaciones.', NULL)
ON DUPLICATE KEY UPDATE title=VALUES(title);
