-- MySQL dump 10.13  Distrib 26.7.0, for Win64 (x86_64)
--
-- Host: localhost    Database: jr_electricidad
-- ------------------------------------------------------
-- Server version	26.7.0

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--
--
-- Table structure for table `admin_notifications`
--

DROP TABLE IF EXISTS `admin_notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_notifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `type` enum('quote_accepted','quote_rejected','quote_request_created','quote_request_status','job_started','job_closed','payment_received','invoice_created','system') COLLATE utf8mb4_unicode_ci NOT NULL,
  `quote_id` int DEFAULT NULL,
  `message` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_notification_quote` (`quote_id`),
  KEY `idx_notifications_read_created` (`is_read`,`created_at`),
  CONSTRAINT `fk_notification_quote` FOREIGN KEY (`quote_id`) REFERENCES `quotes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `gallery`
--

DROP TABLE IF EXISTS `gallery`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gallery` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `image_url` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `featured` tinyint(1) NOT NULL DEFAULT '0',
  `sort_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `jobs`
--

DROP TABLE IF EXISTS `jobs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `jobs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `quote_id` int NOT NULL,
  `status` enum('pendiente_presupuesto','presupuesto_enviado','aceptado','en_proceso','rechazado','cerrado') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pendiente_presupuesto',
  `started_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_job_quote` (`quote_id`),
  CONSTRAINT `fk_job_quote` FOREIGN KEY (`quote_id`) REFERENCES `quotes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `password_resets`
--

DROP TABLE IF EXISTS `password_resets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_resets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `token_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `used` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `fk_reset_user` (`user_id`),
  CONSTRAINT `fk_reset_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `quote_items`
--

DROP TABLE IF EXISTS `quote_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `quote_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `quote_id` int NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` decimal(10,2) NOT NULL DEFAULT '1.00',
  `unit` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unidad',
  `unit_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total` decimal(12,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_quote_item_quote` (`quote_id`),
  CONSTRAINT `fk_quote_item_quote` FOREIGN KEY (`quote_id`) REFERENCES `quotes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;


--
-- Table structure for table `business_settings`
--

DROP TABLE IF EXISTS `business_settings`;
CREATE TABLE `business_settings` (
  `id` tinyint unsigned NOT NULL,
  `business_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'JR Electricidad',
  `legal_name` varchar(180) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `phone` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `whatsapp` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `email` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `city` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `hours` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `logo_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `pdf_footer` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `pdf_notes` text COLLATE utf8mb4_unicode_ci,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `business_settings` (`id`, `business_name`, `phone`, `whatsapp`, `email`, `pdf_footer`) VALUES (1, 'JR Electricidad', '3385684660', '3385684660', 'jorge9609@hotmail.com', 'JR Electricidad · Electricista Matriculado Cat. 3');
--
-- Table structure for table `quote_requests`
--

DROP TABLE IF EXISTS `quote_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `quote_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `service` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `preferred_date` date DEFAULT NULL,
  `image_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('pendiente','contactado','presupuestado','cerrado') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pendiente',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `quotes`
--

DROP TABLE IF EXISTS `quotes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `quotes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `quote_request_id` int NOT NULL,
  `quote_number` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `access_token` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `issue_date` date NOT NULL,
  `expiration_date` date DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `status` enum('borrador','enviado','aceptado','rechazado','vencido','cerrado') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'borrador',
  `subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
  `discount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total` decimal(12,2) NOT NULL DEFAULT '0.00',
  `pdf_filename` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_quote_number` (`quote_number`),
  UNIQUE KEY `uq_access_token` (`access_token`),
  KEY `fk_quote_request` (`quote_request_id`),
  CONSTRAINT `fk_quote_request` FOREIGN KEY (`quote_request_id`) REFERENCES `quote_requests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- JR ELECTRICIDAD V3 — FINANZAS DE SERVICIOS
-- Sin venta de materiales.
--

CREATE TABLE IF NOT EXISTS `service_invoices` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `quote_id` int NOT NULL,
  `invoice_number` varchar(40) NOT NULL,
  `issue_date` date NOT NULL,
  `due_date` date DEFAULT NULL,
  `total` decimal(12,2) NOT NULL DEFAULT '0.00',
  `status` enum('emitida','parcial','pagada','vencida','anulada') NOT NULL DEFAULT 'emitida',
  `notes` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_service_invoice_quote` (`quote_id`),
  UNIQUE KEY `uq_service_invoice_number` (`invoice_number`),
  KEY `idx_service_invoice_date` (`issue_date`),
  KEY `idx_service_invoice_status` (`status`),
  CONSTRAINT `fk_service_invoice_quote` FOREIGN KEY (`quote_id`) REFERENCES `quotes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `service_payments` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `invoice_id` bigint unsigned NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `payment_date` date NOT NULL,
  `method` enum('efectivo','transferencia','tarjeta','otro') NOT NULL DEFAULT 'otro',
  `reference` varchar(150) DEFAULT NULL,
  `notes` varchar(1000) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_service_payment_invoice` (`invoice_id`),
  KEY `idx_service_payment_date` (`payment_date`),
  CONSTRAINT `fk_service_payment_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `service_invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `business_expenses` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `expense_date` date NOT NULL,
  `category` varchar(100) NOT NULL DEFAULT 'general',
  `description` varchar(500) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `notes` varchar(1000) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_business_expense_date` (`expense_date`),
  KEY `idx_business_expense_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `services`
--

DROP TABLE IF EXISTS `services`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `services` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `price` decimal(12,2) DEFAULT NULL,
  `category` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sessions`
--

DROP TABLE IF EXISTS `sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sessions` (
  `session_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` int unsigned NOT NULL,
  `data` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('user','admin') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping routines for database 'jr_electricidad'
--
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-09-18  3:39:13


-- JR ELECTRICIDAD V3 — BLOQUE H: MATERIALES TÉCNICOS
-- Los materiales son información técnica para ejecutar trabajos.
-- NO contienen precio, stock, proveedor, compra ni venta.
CREATE TABLE IF NOT EXISTS `material_categories` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `uq_material_category_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `material_units` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `symbol` varchar(20) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `uq_material_unit_name` (`name`), UNIQUE KEY `uq_material_unit_symbol` (`symbol`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `materials` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(180) NOT NULL,
  `description` varchar(500) DEFAULT NULL,
  `category_id` int unsigned DEFAULT NULL,
  `unit_id` int unsigned NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `idx_material_category` (`category_id`), KEY `idx_material_unit` (`unit_id`), KEY `idx_material_active_name` (`active`,`name`),
  CONSTRAINT `fk_material_category` FOREIGN KEY (`category_id`) REFERENCES `material_categories`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_material_unit` FOREIGN KEY (`unit_id`) REFERENCES `material_units`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `quote_materials` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `quote_id` int NOT NULL,
  `material_id` int unsigned NOT NULL,
  `quantity` decimal(12,3) NOT NULL DEFAULT 1.000,
  `notes` varchar(500) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `uq_quote_material` (`quote_id`,`material_id`), KEY `idx_quote_material_quote` (`quote_id`), KEY `idx_quote_material_material` (`material_id`),
  CONSTRAINT `fk_quote_material_quote` FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_quote_material_material` FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO `material_categories` (`name`) VALUES ('Conductores'),('Protecciones'),('Canalización'),('Cajas y accesorios'),('Iluminación'),('Conexiones'),('Herramientas y consumibles'),('Otros');
INSERT IGNORE INTO `material_units` (`name`,`symbol`) VALUES ('Unidad','un'),('Metro','m'),('Rollo','rollo'),('Juego','juego'),('Caja','caja'),('Par','par');


-- JR ELECTRICIDAD V3 — BLOQUE J: EMAIL
-- Comunicaciones por correo electrónico. Sin venta de materiales.
CREATE TABLE IF NOT EXISTS `email_templates` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `event_key` varchar(80) NOT NULL,
  `subject` varchar(255) NOT NULL,
  `body` text NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `uq_email_template_event_name` (`event_key`,`name`), KEY `idx_email_template_event_active` (`event_key`,`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `email_messages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `template_id` int unsigned DEFAULT NULL,
  `event_key` varchar(80) NOT NULL DEFAULT 'general',
  `recipient_name` varchar(150) DEFAULT NULL,
  `recipient_email` varchar(190) NOT NULL,
  `subject` varchar(255) NOT NULL,
  `body` text NOT NULL,
  `target_type` varchar(50) DEFAULT NULL,
  `target_id` bigint unsigned DEFAULT NULL,
  `status` enum('prepared','sent','failed') NOT NULL DEFAULT 'prepared',
  `error_message` varchar(1000) DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `idx_email_message_recipient` (`recipient_email`), KEY `idx_email_message_event` (`event_key`), KEY `idx_email_message_status` (`status`), KEY `idx_email_message_created` (`created_at`),
  CONSTRAINT `fk_email_message_template` FOREIGN KEY (`template_id`) REFERENCES `email_templates`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO `email_templates` (`name`,`event_key`,`subject`,`body`) VALUES
('Presupuesto enviado','quote_sent','Presupuesto {presupuesto} - JR Electricidad','Hola {cliente},\\n\\nTe enviamos el presupuesto {presupuesto} por un total de {total}.\\n\\nPodés consultar el detalle desde: {url}\\n\\nSaludos,\\nJR Electricidad'),
('Presupuesto aceptado','quote_accepted','Presupuesto {presupuesto} aceptado - JR Electricidad','Hola {cliente},\\n\\nRegistramos la aceptación del presupuesto {presupuesto}.\\n\\nNos pondremos en contacto para coordinar el trabajo.\\n\\nJR Electricidad'),
('Presupuesto rechazado','quote_rejected','Presupuesto {presupuesto} rechazado - JR Electricidad','Hola {cliente},\\n\\nRegistramos el rechazo del presupuesto {presupuesto}.\\n\\nSi necesitás realizar una nueva consulta, estamos a disposición.\\n\\nJR Electricidad'),
('Turno confirmado','appointment_confirmed','Turno confirmado - JR Electricidad','Hola {cliente},\\n\\nTu turno quedó confirmado para el {fecha} a las {hora}.\\n\\nDetalle: {detalle}\\n\\nJR Electricidad'),
('Aviso de trabajo','job_notice','Actualización de trabajo - JR Electricidad','Hola {cliente},\\n\\nTenemos una actualización sobre tu trabajo: {trabajo}.\\n\\n{detalle}\\n\\nJR Electricidad'),
('Aviso de pago','payment_notice','Actualización de pago - JR Electricidad','Hola {cliente},\\n\\nTe informamos una actualización relacionada con el pago del servicio.\\n\\n{detalle}\\n\\nJR Electricidad');


-- JR ELECTRICIDAD V3 — BLOQUE K: FIRMA DIGITAL
CREATE TABLE IF NOT EXISTS `digital_signatures` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `quote_id` int DEFAULT NULL,
  `document_type` varchar(60) NOT NULL DEFAULT 'quote',
  `document_id` bigint unsigned DEFAULT NULL,
  `signer_name` varchar(150) NOT NULL,
  `signer_email` varchar(190) DEFAULT NULL,
  `signature_data` longtext NOT NULL,
  `signed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` varchar(500) DEFAULT NULL,
  `evidence_hash` char(64) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `idx_signature_quote` (`quote_id`), KEY `idx_signature_document` (`document_type`,`document_id`), KEY `idx_signature_date` (`signed_at`), UNIQUE KEY `uq_signature_quote_type` (`quote_id`,`document_type`),
  CONSTRAINT `fk_signature_quote` FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- V3 notification preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  quote_requests TINYINT(1) NOT NULL DEFAULT 1,
  quote_status TINYINT(1) NOT NULL DEFAULT 1,
  jobs TINYINT(1) NOT NULL DEFAULT 1,
  payments TINYINT(1) NOT NULL DEFAULT 1,
  system TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO notification_preferences (id) VALUES (1) ON DUPLICATE KEY UPDATE id=id;


-- JR Electricidad V3 — configuración general
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- JR Electricidad V3 — seguridad avanzada
CREATE TABLE IF NOT EXISTS admin_security (id TINYINT UNSIGNED NOT NULL PRIMARY KEY,two_factor_enabled TINYINT(1) NOT NULL DEFAULT 0,two_factor_secret VARBINARY(64) DEFAULT NULL,updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS security_audit_log (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,user_id INT UNSIGNED NULL,action VARCHAR(120) NOT NULL,method VARCHAR(10) NOT NULL,path VARCHAR(255) NOT NULL,status_code SMALLINT UNSIGNED NOT NULL,ip_address VARCHAR(64) NULL,user_agent VARCHAR(500) NULL,details TEXT NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX idx_security_audit_created (created_at),INDEX idx_security_audit_user (user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
