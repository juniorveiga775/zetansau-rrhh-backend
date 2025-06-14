-- Crear tabla para registrar las descargas de nóminas
CREATE TABLE `payroll_downloads` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `payroll_record_id` int(11) NOT NULL,
  `document_id` int(11) DEFAULT NULL,
  `download_type` enum('download','view') NOT NULL DEFAULT 'download',
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `downloaded_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_payroll_record_id` (`payroll_record_id`),
  KEY `idx_document_id` (`document_id`),
  KEY `idx_downloaded_at` (`downloaded_at`),
  CONSTRAINT `payroll_downloads_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `payroll_downloads_ibfk_2` FOREIGN KEY (`payroll_record_id`) REFERENCES `payroll_records` (`id`) ON DELETE CASCADE,
  CONSTRAINT `payroll_downloads_ibfk_3` FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;