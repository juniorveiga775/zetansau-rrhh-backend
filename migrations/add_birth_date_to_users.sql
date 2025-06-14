-- Active: 1742428211207@@127.0.0.1@3306@rrhh_portal
-- Migración para agregar campo de fecha de nacimiento a la tabla users
-- Fecha: 2025-06-12
-- Descripción: Añade el campo birth_date para permitir felicitaciones automáticas de cumpleaños

ALTER TABLE users 
ADD COLUMN birth_date DATE DEFAULT NULL 
AFTER last_name;

-- Crear índice para optimizar consultas de cumpleaños
CREATE INDEX idx_users_birth_date ON users(birth_date);

-- Comentario sobre el campo
ALTER TABLE users 
MODIFY COLUMN birth_date DATE DEFAULT NULL COMMENT 'Fecha de nacimiento del empleado para felicitaciones automáticas';