const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

class WebSocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> socketId
  }

  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"]
      }
    });

    // Middleware de autenticación para WebSocket
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        
        if (!token) {
          return next(new Error('Token de autenticación requerido'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Verificar que el usuario existe
        const [users] = await pool.execute(
          'SELECT id, email, role FROM users WHERE id = ?',
          [decoded.id]
        );

        if (users.length === 0) {
          return next(new Error('Usuario no encontrado'));
        }

        socket.userId = decoded.id;
        socket.userRole = users[0].role;
        next();
      } catch (error) {
        console.error('Error en autenticación WebSocket:', error);
        next(new Error('Token inválido'));
      }
    });

    this.io.on('connection', (socket) => {
      console.log(`Usuario ${socket.userId} conectado via WebSocket`);
      
      // Registrar usuario conectado
      this.connectedUsers.set(socket.userId, socket.id);
      
      // Unirse a sala de su rol
      socket.join(`role_${socket.userRole}`);
      
      // Unirse a sala personal
      socket.join(`user_${socket.userId}`);

      // Manejar desconexión
      socket.on('disconnect', () => {
        console.log(`Usuario ${socket.userId} desconectado`);
        this.connectedUsers.delete(socket.userId);
      });

      // Manejar solicitud de notificaciones no leídas
      socket.on('get_unread_count', async () => {
        try {
          const unreadCount = await this.getUnreadCount(socket.userId);
          socket.emit('unread_count_update', { count: unreadCount });
        } catch (error) {
          console.error('Error obteniendo conteo no leído:', error);
        }
      });

      // Manejar marcado como leído en tiempo real
      socket.on('mark_as_read', async (data) => {
        try {
          const { notificationId } = data;
          await this.markAsRead(socket.userId, notificationId);
          
          // Emitir actualización de conteo
          const unreadCount = await this.getUnreadCount(socket.userId);
          socket.emit('unread_count_update', { count: unreadCount });
        } catch (error) {
          console.error('Error marcando como leído:', error);
        }
      });
    });

    console.log('Servicio WebSocket inicializado');
  }

  // Enviar notificación a usuario específico
  async sendToUser(userId, notification) {
    if (this.io) {
      this.io.to(`user_${userId}`).emit('new_notification', notification);
      
      // También actualizar conteo no leído
      const unreadCount = await this.getUnreadCount(userId);
      this.io.to(`user_${userId}`).emit('unread_count_update', { count: unreadCount });
    }
  }

  // Enviar notificación a todos los usuarios
  async sendToAll(notification) {
    if (this.io) {
      this.io.emit('new_notification', notification);
      
      // Actualizar conteo para todos los usuarios conectados
      for (const userId of this.connectedUsers.keys()) {
        const unreadCount = await this.getUnreadCount(userId);
        this.io.to(`user_${userId}`).emit('unread_count_update', { count: unreadCount });
      }
    }
  }

  // Enviar notificación a usuarios con rol específico
  async sendToRole(role, notification) {
    if (this.io) {
      this.io.to(`role_${role}`).emit('new_notification', notification);
      
      // Actualizar conteo para usuarios del rol específico
      const [users] = await pool.execute(
        'SELECT id FROM users WHERE role = ?',
        [role]
      );
      
      for (const user of users) {
        if (this.connectedUsers.has(user.id)) {
          const unreadCount = await this.getUnreadCount(user.id);
          this.io.to(`user_${user.id}`).emit('unread_count_update', { count: unreadCount });
        }
      }
    }
  }

  // Obtener conteo de notificaciones no leídas
  async getUnreadCount(userId) {
    try {
      const [result] = await pool.execute(
        `SELECT COUNT(DISTINCT n.id) as unread_count
         FROM notifications n
         LEFT JOIN notification_reads nr ON n.id = nr.notification_id AND nr.user_id = ?
         WHERE (n.recipients_type = 'all' OR nr.user_id = ?) 
           AND (nr.read_at IS NULL OR nr.user_id IS NULL)`,
        [userId, userId]
      );
      return result[0].unread_count;
    } catch (error) {
      console.error('Error obteniendo conteo no leído:', error);
      return 0;
    }
  }

  // Marcar notificación como leída
  async markAsRead(userId, notificationId) {
    try {
      // Verificar si ya existe un registro
      const [existing] = await pool.execute(
        'SELECT id FROM notification_reads WHERE user_id = ? AND notification_id = ?',
        [userId, notificationId]
      );

      if (existing.length === 0) {
        // Crear nuevo registro
        await pool.execute(
          'INSERT INTO notification_reads (user_id, notification_id, read_at) VALUES (?, ?, NOW())',
          [userId, notificationId]
        );
      } else {
        // Actualizar registro existente
        await pool.execute(
          'UPDATE notification_reads SET read_at = NOW() WHERE user_id = ? AND notification_id = ?',
          [userId, notificationId]
        );
      }
    } catch (error) {
      console.error('Error marcando como leído:', error);
      throw error;
    }
  }

  // Obtener instancia del servicio
  getIO() {
    return this.io;
  }

  // Verificar si un usuario está conectado
  isUserConnected(userId) {
    return this.connectedUsers.has(userId);
  }

  // Obtener usuarios conectados
  getConnectedUsers() {
    return Array.from(this.connectedUsers.keys());
  }
}

// Exportar instancia singleton
const webSocketService = new WebSocketService();
module.exports = webSocketService;