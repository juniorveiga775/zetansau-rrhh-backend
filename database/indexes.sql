-- Índices para optimizar consultas de notificaciones
-- Ejecutar estos comandos en la base de datos para mejorar el rendimiento

-- Índice para consultas por tipo de notificación
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- Índice para consultas por fecha de creación (para ordenamiento)
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- Índice para consultas por tipo de destinatarios
CREATE INDEX IF NOT EXISTS idx_notifications_recipients_type ON notifications(recipients_type);

-- Índice compuesto para consultas frecuentes de notificaciones
CREATE INDEX IF NOT EXISTS idx_notifications_type_created ON notifications(type, created_at DESC);

-- Índice para notification_reads por usuario
CREATE INDEX IF NOT EXISTS idx_notification_reads_user_id ON notification_reads(user_id);

-- Índice para notification_reads por notificación
CREATE INDEX IF NOT EXISTS idx_notification_reads_notification_id ON notification_reads(notification_id);

-- Índice compuesto para consultas de estado de lectura
CREATE INDEX IF NOT EXISTS idx_notification_reads_user_notification ON notification_reads(user_id, notification_id);

-- Índice para consultas de notificaciones no leídas
CREATE INDEX IF NOT EXISTS idx_notification_reads_read_at ON notification_reads(read_at);

-- Índice compuesto para optimizar consultas de notificaciones de usuario
CREATE INDEX IF NOT EXISTS idx_notification_reads_user_read ON notification_reads(user_id, read_at);

-- Índice para usuarios por rol (si no existe)
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Índice para usuarios por email (si no existe)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Comentarios sobre el uso de los índices:
-- idx_notifications_type: Para filtrar por tipo de notificación
-- idx_notifications_created_at: Para ordenar por fecha de creación
-- idx_notifications_recipients_type: Para filtrar por tipo de destinatarios
-- idx_notifications_type_created: Para consultas que filtran por tipo y ordenan por fecha
-- idx_notification_reads_user_id: Para obtener todas las lecturas de un usuario
-- idx_notification_reads_notification_id: Para obtener todas las lecturas de una notificación
-- idx_notification_reads_user_notification: Para verificar si un usuario leyó una notificación específica
-- idx_notification_reads_read_at: Para filtrar por estado de lectura
-- idx_notification_reads_user_read: Para obtener notificaciones no leídas de un usuario
-- idx_users_role: Para filtrar usuarios por rol
-- idx_users_email: Para búsquedas por email