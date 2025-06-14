-- Script para crear índices de optimización para notificaciones
-- Ejecutar este script en tu cliente MySQL preferido (phpMyAdmin, MySQL Workbench, etc.)
-- O usar: mysql -u root -p rrhh_portal < setup_indexes.sql

USE rrhh_portal;

-- Verificar si las tablas existen antes de crear índices
SHOW TABLES LIKE 'notifications';
SHOW TABLES LIKE 'notification_reads';

-- Índices para la tabla notifications
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipients_type ON notifications(recipients_type);
CREATE INDEX IF NOT EXISTS idx_notifications_type_created ON notifications(type, created_at DESC);

-- Índices para la tabla notification_reads
CREATE INDEX IF NOT EXISTS idx_notification_reads_user_id ON notification_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_reads_notification_id ON notification_reads(notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_reads_user_notification ON notification_reads(user_id, notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_reads_read_at ON notification_reads(read_at);
CREATE INDEX IF NOT EXISTS idx_notification_reads_user_read ON notification_reads(user_id, read_at);

-- Índices para la tabla users (si no existen)
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Mostrar los índices creados
SHOW INDEX FROM notifications;
SHOW INDEX FROM notification_reads;
SHOW INDEX FROM users;

SELECT 'Índices de optimización creados exitosamente' AS status;