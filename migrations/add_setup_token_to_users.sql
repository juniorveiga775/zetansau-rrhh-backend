-- Migración para agregar campos de token de configuración de contraseña
-- Fecha: 2025-06-11
-- Descripción: Agregar campos setup_token y setup_token_expiry a la tabla users

ALTER TABLE `users` 
ADD COLUMN `setup_token` VARCHAR(255) NULL DEFAULT NULL AFTER `first_login`,
ADD COLUMN `setup_token_expiry` DATETIME NULL DEFAULT NULL AFTER `setup_token`;

-- Crear índice para el token de configuración para búsquedas rápidas
CREATE INDEX `idx_setup_token` ON `users` (`setup_token`);

-- Comentarios sobre los nuevos campos:
-- setup_token: Token único para permitir al usuario configurar su contraseña
-- setup_token_expiry: Fecha y hora de expiración del token (24 horas desde la creación)