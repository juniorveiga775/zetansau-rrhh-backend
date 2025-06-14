const express = require('express');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { sendGeneralNotification, getAllEmployeeEmails } = require('../services/emailService');
const { auditLogger } = require('../middleware/security');
const webSocketService = require('../services/websocketService');
const { 
  notificationTypesCache, 
  statsCache, 
  unreadCountCache, 
  clearNotificationCaches,
  generateCacheKey 
} = require('../config/cache');

const router = express.Router();

// Validaciones
const notificationValidation = [
  body('title').isLength({ min: 3, max: 100 }).withMessage('El título debe tener entre 3 y 100 caracteres'),
  body('message').isLength({ min: 10, max: 1000 }).withMessage('El mensaje debe tener entre 10 y 1000 caracteres'),
  body('type').isIn(['general', 'urgent', 'info']).withMessage('Tipo de notificación inválido'),
  body('recipients').isIn(['all', 'specific']).withMessage('Tipo de destinatarios inválido'),
  body('userIds').optional().isArray().withMessage('Los IDs de usuarios deben ser un array')
];

// GET /api/notifications - Obtener notificaciones (admin)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, user_id, type, status } = req.query;
    const offset = (page - 1) * limit;

    // Construir filtros dinámicos
    let whereClause = 'WHERE 1=1';
    let queryParams = [];

    if (user_id) {
      whereClause += ' AND (n.recipients_type = "specific" AND nr.user_id = ?)';
      queryParams.push(user_id);
    }

    if (type) {
      whereClause += ' AND n.type = ?';
      queryParams.push(type);
    }

    // Construir JOIN para filtros de estado
    let joinClause = '';
    if (status || user_id) {
      joinClause = 'LEFT JOIN notification_reads nr ON n.id = nr.notification_id';
      
      if (status === 'read') {
        whereClause += ' AND nr.read_at IS NOT NULL';
      } else if (status === 'unread') {
        whereClause += ' AND nr.read_at IS NULL';
      }
    }

    // Obtener total de notificaciones
    const [countResult] = await pool.execute(
      `SELECT COUNT(DISTINCT n.id) as total 
       FROM notifications n ${joinClause} ${whereClause}`,
      queryParams
    );
    const total = countResult[0].total;

    // Obtener notificaciones paginadas
    const [notifications] = await pool.execute(
      `SELECT DISTINCT n.id, n.title, n.message, n.type, n.recipients_type, 
              n.recipients_count, n.created_by, n.created_at, n.updated_at
       FROM notifications n ${joinClause} ${whereClause}
       ORDER BY n.created_at DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, parseInt(limit), parseInt(offset)]
    );

    res.json({
      success: true,
      data: {
        notifications,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        },
        filters: {
          user_id,
          type,
          status
        }
      }
    });

  } catch (error) {
    console.error('Error obteniendo notificaciones:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// GET /api/notifications/user - Obtener notificaciones del usuario
router.get('/user', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, unread_only = false, type } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE (n.recipients_type = "all" OR nr.user_id = ?)';
    let queryParams = [userId];

    if (unread_only === 'true') {
      whereClause += ' AND (nr.read_at IS NULL OR nr.user_id IS NULL)';
    }

    if (type) {
      whereClause += ' AND n.type = ?';
      queryParams.push(type);
    }

    // Obtener total de notificaciones
    const [countResult] = await pool.execute(
      `SELECT COUNT(DISTINCT n.id) as total 
       FROM notifications n
       LEFT JOIN notification_reads nr ON n.id = nr.notification_id AND nr.user_id = ?
       ${whereClause}`,
      [userId, ...queryParams]
    );
    const total = countResult[0].total;

    // Obtener notificaciones del usuario
    const [notifications] = await pool.execute(
      `SELECT DISTINCT n.id, n.title, n.message, n.type, n.created_at,
              nr.read_at, nr.read_at IS NOT NULL as is_read
       FROM notifications n
       LEFT JOIN notification_reads nr ON n.id = nr.notification_id AND nr.user_id = ?
       ${whereClause}
       ORDER BY n.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, ...queryParams, parseInt(limit), parseInt(offset)]
    );

    res.json({
      success: true,
      data: {
        notifications,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        },
        filters: {
          unread_only: unread_only === 'true',
          type
        }
      }
    });

  } catch (error) {
    console.error('Error obteniendo notificaciones del usuario:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// POST /api/notifications - Crear nueva notificación (admin)
router.post('/', authenticateToken, requireAdmin, notificationValidation, 
  auditLogger('CREATE_NOTIFICATION', 'notifications'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        errors: errors.array()
      });
    }

    const { title, message, type, recipients, userIds } = req.body;
    const createdBy = req.user.id;

    let recipientEmails = [];
    let recipientsCount = 0;

    if (recipients === 'all') {
      // Obtener todos los emails de empleados activos
      recipientEmails = await getAllEmployeeEmails(pool);
      recipientsCount = recipientEmails.length;
    } else if (recipients === 'specific' && userIds && userIds.length > 0) {
      // Obtener emails de usuarios específicos
      const placeholders = userIds.map(() => '?').join(',');
      const [users] = await pool.execute(
        `SELECT email FROM users WHERE id IN (${placeholders}) AND status = 'active'`,
        userIds
      );
      recipientEmails = users.map(user => user.email);
      recipientsCount = recipientEmails.length;
    }

    if (recipientEmails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No se encontraron destinatarios válidos'
      });
    }

    // Crear notificación en la base de datos
    const [result] = await pool.execute(
      `INSERT INTO notifications (title, message, type, recipients_type, recipients_count, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, message, type, recipients, recipientsCount, createdBy]
    );

    const notificationId = result.insertId;

    // Si es para usuarios específicos, crear registros de lectura
    if (recipients === 'specific' && userIds && userIds.length > 0) {
      const readRecords = userIds.map(userId => [notificationId, userId]);
      const placeholders = readRecords.map(() => '(?, ?)').join(',');
      const flatValues = readRecords.flat();
      
      await pool.execute(
        `INSERT INTO notification_reads (notification_id, user_id) VALUES ${placeholders}`,
        flatValues
      );
    }

    // Enviar emails
    try {
      const actionUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/notifications`;
      await sendGeneralNotification(recipientEmails, title, message, actionUrl);
      console.log(`Notificación enviada a ${recipientEmails.length} destinatarios`);
    } catch (emailError) {
      console.error('Error enviando emails de notificación:', emailError);
      // No fallar la operación si el email falla
    }

    // Enviar notificación en tiempo real via WebSocket
    try {
      if (recipients === 'all') {
        await webSocketService.sendToAll({
          id: notificationId,
          title: title,
          message: message,
          type: type,
          created_at: new Date().toISOString()
        });
      } else {
        // Enviar a usuarios específicos
        for (const userId of userIds) {
          await webSocketService.sendToUser(userId, {
            id: notificationId,
            title: title,
            message: message,
            type: type,
            created_at: new Date().toISOString()
          });
        }
      }
    } catch (wsError) {
      console.error('Error enviando notificación WebSocket:', wsError);
      // No fallar la creación por error de WebSocket
    }

    // Limpiar caches relacionados
    clearNotificationCaches();

    // Obtener la notificación creada
    const [newNotification] = await pool.execute(
      `SELECT id, title, message, type, recipients_type, recipients_count, 
              created_by, created_at
       FROM notifications WHERE id = ?`,
      [notificationId]
    );

    res.status(201).json({
      success: true,
      message: 'Notificación creada y enviada correctamente',
      data: { notification: newNotification[0] }
    });

  } catch (error) {
    console.error('Error creando notificación:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// PUT /api/notifications/:id/read - Marcar notificación como leída
router.put('/:id/read', authenticateToken, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.id;

    // Verificar que la notificación existe
    const [notifications] = await pool.execute(
      'SELECT id, recipients_type FROM notifications WHERE id = ?',
      [notificationId]
    );

    if (notifications.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Notificación no encontrada'
      });
    }

    const notification = notifications[0];

    if (notification.recipients_type === 'all') {
      // Para notificaciones generales, crear o actualizar registro de lectura
      await pool.execute(
        `INSERT INTO notification_reads (notification_id, user_id, read_at) 
         VALUES (?, ?, NOW()) 
         ON DUPLICATE KEY UPDATE read_at = NOW()`,
        [notificationId, userId]
      );
    } else {
      // Para notificaciones específicas, actualizar registro existente
      await pool.execute(
        `UPDATE notification_reads 
         SET read_at = NOW() 
         WHERE notification_id = ? AND user_id = ?`,
        [notificationId, userId]
      );
    }

    // Limpiar cache del usuario
    const userCacheKey = generateCacheKey('unread_count', userId);
    unreadCountCache.del(userCacheKey);
    
    // Limpiar cache de estadísticas
    const statsCacheKey = generateCacheKey('stats', 'user', userId);
    statsCache.del(statsCacheKey);

    res.json({
      success: true,
      message: 'Notificación marcada como leída'
    });

  } catch (error) {
    console.error('Error marcando notificación como leída:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// PUT /api/notifications/:id/unread - Marcar notificación como no leída
router.put('/:id/unread', authenticateToken, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.id;

    // Verificar que la notificación existe
    const [notifications] = await pool.execute(
      'SELECT id, recipients_type FROM notifications WHERE id = ?',
      [notificationId]
    );

    if (notifications.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Notificación no encontrada'
      });
    }

    const notification = notifications[0];

    if (notification.recipients_type === 'all') {
      // Para notificaciones generales, eliminar registro de lectura
      await pool.execute(
        'DELETE FROM notification_reads WHERE notification_id = ? AND user_id = ?',
        [notificationId, userId]
      );
    } else {
      // Para notificaciones específicas, actualizar registro existente
      await pool.execute(
        `UPDATE notification_reads 
         SET read_at = NULL 
         WHERE notification_id = ? AND user_id = ?`,
        [notificationId, userId]
      );
    }

    // Limpiar cache del usuario
    const userCacheKey = generateCacheKey('unread_count', userId);
    unreadCountCache.del(userCacheKey);
    
    // Limpiar cache de estadísticas
    const statsCacheKey = generateCacheKey('stats', 'user', userId);
    statsCache.del(statsCacheKey);

    res.json({
      success: true,
      message: 'Notificación marcada como no leída'
    });

  } catch (error) {
    console.error('Error marcando notificación como no leída:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// PUT /api/notifications/mark-multiple-read - Marcar múltiples notificaciones como leídas
router.put('/mark-multiple-read', authenticateToken, async (req, res) => {
  try {
    const { notification_ids } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(notification_ids) || notification_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere un array de IDs de notificaciones'
      });
    }

    // Verificar que las notificaciones existen
    const placeholders = notification_ids.map(() => '?').join(',');
    const [notifications] = await pool.execute(
      `SELECT id, recipients_type FROM notifications WHERE id IN (${placeholders})`,
      notification_ids
    );

    if (notifications.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No se encontraron notificaciones válidas'
      });
    }

    // Procesar cada notificación
    for (const notification of notifications) {
      if (notification.recipients_type === 'all') {
        // Para notificaciones generales, crear o actualizar registro de lectura
        await pool.execute(
          `INSERT INTO notification_reads (notification_id, user_id, read_at) 
           VALUES (?, ?, NOW()) 
           ON DUPLICATE KEY UPDATE read_at = NOW()`,
          [notification.id, userId]
        );
      } else {
        // Para notificaciones específicas, actualizar registro existente
        await pool.execute(
          `UPDATE notification_reads 
           SET read_at = NOW() 
           WHERE notification_id = ? AND user_id = ?`,
          [notification.id, userId]
        );
      }
    }

    res.json({
      success: true,
      message: `${notifications.length} notificaciones marcadas como leídas`
    });

  } catch (error) {
    console.error('Error marcando múltiples notificaciones como leídas:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// DELETE /api/notifications/:id - Eliminar notificación (solo admin)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const adminId = req.user.id;

    // Verificar que la notificación existe
    const [notification] = await pool.execute(
      'SELECT * FROM notifications WHERE id = ?',
      [notificationId]
    );

    if (notification.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Notificación no encontrada'
      });
    }

    // Validación adicional: verificar que el admin tiene permisos
    // (En este caso, cualquier admin puede eliminar, pero se puede personalizar)
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'No tienes permisos para eliminar esta notificación'
      });
    }

    // Eliminar registros de lectura relacionados
    await pool.execute(
      'DELETE FROM notification_reads WHERE notification_id = ?',
      [notificationId]
    );

    // Eliminar la notificación
    await pool.execute(
      'DELETE FROM notifications WHERE id = ?',
      [notificationId]
    );

    // Limpiar todos los caches relacionados
    clearNotificationCaches();

    // Log de auditoría
    console.log('Notificación eliminada:', {
      adminId,
      notificationId,
      notificationTitle: notification[0].title,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Notificación eliminada exitosamente'
    });

  } catch (error) {
    console.error('Error eliminando notificación:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// GET /api/notifications/stats - Obtener estadísticas de notificaciones
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const { period = 'week', start_date, end_date } = req.query;
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    const cacheKey = generateCacheKey('stats', isAdmin ? 'admin' : 'user', userId, period);

    // Intentar obtener del cache
    let cachedStats = statsCache.get(cacheKey);
    
    if (cachedStats) {
      return res.json({
        success: true,
        data: {
          period,
          stats: cachedStats
        }
      });
    }

    let dateFilter = '';
    let dateParams = [];

    // Configurar filtro de fecha según el período
    if (start_date && end_date) {
      dateFilter = 'AND n.created_at BETWEEN ? AND ?';
      dateParams = [start_date, end_date];
    } else {
      const now = new Date();
      let startDate;
      
      switch (period) {
        case 'day':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'year':
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      }
      
      dateFilter = 'AND n.created_at >= ?';
      dateParams = [startDate.toISOString().split('T')[0]];
    }

    let stats = {};

    if (isAdmin) {
      // Estadísticas para administradores
      const [totalStats] = await pool.execute(
        `SELECT 
           COUNT(*) as total_notifications,
           SUM(CASE WHEN type = 'general' THEN 1 ELSE 0 END) as general_count,
           SUM(CASE WHEN type = 'urgent' THEN 1 ELSE 0 END) as urgent_count,
           SUM(CASE WHEN type = 'info' THEN 1 ELSE 0 END) as info_count,
           AVG(recipients_count) as avg_recipients
         FROM notifications n
         WHERE 1=1 ${dateFilter}`,
        dateParams
      );

      const [readStats] = await pool.execute(
        `SELECT 
           COUNT(DISTINCT nr.notification_id) as read_notifications,
           COUNT(DISTINCT nr.user_id) as users_who_read
         FROM notification_reads nr
         JOIN notifications n ON nr.notification_id = n.id
         WHERE nr.read_at IS NOT NULL ${dateFilter}`,
        dateParams
      );

      stats = {
        total_notifications: totalStats[0].total_notifications,
        notifications_by_type: {
          general: totalStats[0].general_count,
          urgent: totalStats[0].urgent_count,
          info: totalStats[0].info_count
        },
        read_notifications: readStats[0].read_notifications,
        users_who_read: readStats[0].users_who_read,
        avg_recipients: Math.round(totalStats[0].avg_recipients || 0)
      };
    } else {
      // Estadísticas para usuarios regulares
      const [userStats] = await pool.execute(
        `SELECT 
           COUNT(DISTINCT n.id) as total_notifications,
           COUNT(DISTINCT CASE WHEN nr.read_at IS NOT NULL THEN n.id END) as read_notifications,
           COUNT(DISTINCT CASE WHEN nr.read_at IS NULL THEN n.id END) as unread_notifications
         FROM notifications n
         LEFT JOIN notification_reads nr ON n.id = nr.notification_id AND nr.user_id = ?
         WHERE (n.recipients_type = 'all' OR nr.user_id = ?) ${dateFilter}`,
        [userId, userId, ...dateParams]
      );

      stats = {
        total_notifications: userStats[0].total_notifications,
        read_notifications: userStats[0].read_notifications,
        unread_notifications: userStats[0].unread_notifications
      };
    }

    // Guardar en cache
    statsCache.set(cacheKey, stats);

    res.json({
      success: true,
      data: {
        period,
        stats
      }
    });

  } catch (error) {
    console.error('Error obteniendo estadísticas de notificaciones:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// GET /api/notifications/types - Obtener tipos de notificaciones disponibles
router.get('/types', authenticateToken, async (req, res) => {
  try {
    const cacheKey = 'notification_types';
    
    // Intentar obtener del cache
    let types = notificationTypesCache.get(cacheKey);
    
    if (!types) {
      // Si no está en cache, generar los tipos
      types = [
        {
          value: 'general',
          label: 'General',
          description: 'Notificaciones generales del sistema'
        },
        {
          value: 'urgent',
          label: 'Urgente',
          description: 'Notificaciones urgentes que requieren atención inmediata'
        },
        {
          value: 'info',
          label: 'Informativa',
          description: 'Notificaciones informativas'
        }
      ];
      
      // Guardar en cache
      notificationTypesCache.set(cacheKey, types);
    }

    res.json({
      success: true,
      data: { types }
    });

  } catch (error) {
    console.error('Error obteniendo tipos de notificaciones:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// GET /api/notifications/unread-count - Obtener cantidad de notificaciones no leídas
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const cacheKey = generateCacheKey('unread_count', userId);
    
    // Intentar obtener del cache
    let unreadCount = unreadCountCache.get(cacheKey);
    
    if (unreadCount === undefined) {
      const [result] = await pool.execute(
        `SELECT COUNT(DISTINCT n.id) as unread_count
         FROM notifications n
         LEFT JOIN notification_reads nr ON n.id = nr.notification_id AND nr.user_id = ?
         WHERE (n.recipients_type = 'all' OR nr.user_id = ?) 
           AND (nr.read_at IS NULL OR nr.user_id IS NULL)`,
        [userId, userId]
      );
      
      unreadCount = result[0].unread_count;
      
      // Guardar en cache
      unreadCountCache.set(cacheKey, unreadCount);
    }

    res.json({
      success: true,
      data: { unread_count: unreadCount }
    });

  } catch (error) {
    console.error('Error obteniendo cantidad de notificaciones no leídas:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

module.exports = router;