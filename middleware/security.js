const rateLimit = require('express-rate-limit');
const { pool } = require('../config/database');

// Rate limiting para login
const loginLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutos
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 5, // 5 intentos por IP
  message: {
    success: false,
    message: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

// Rate limiting general para API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por IP
  message: {
    success: false,
    message: 'Demasiadas solicitudes. Intenta de nuevo más tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Middleware para logging de auditoría
const auditLogger = (action, tableName = null) => {
  return async (req, res, next) => {
    const originalSend = res.send;
    
    res.send = function(data) {
      // Solo loggear si la operación fue exitosa
      if (res.statusCode >= 200 && res.statusCode < 300) {
        logAuditEvent({
          userId: req.user?.id || null,
          action,
          tableName,
          recordId: req.params.id || req.params.userId || null,
          oldValues: req.auditOldValues || null,
          newValues: req.body || null,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent')
        }).catch(error => {
          console.error('Error logging audit event:', error);
        });
      }
      
      originalSend.call(this, data);
    };
    
    next();
  };
};

// Función para registrar eventos de auditoría
const logAuditEvent = async (eventData) => {
  try {
    await pool.execute(`
      INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, new_values, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      eventData.userId,
      eventData.action,
      eventData.tableName,
      eventData.recordId,
      eventData.oldValues ? JSON.stringify(eventData.oldValues) : null,
      eventData.newValues ? JSON.stringify(eventData.newValues) : null,
      eventData.ipAddress,
      eventData.userAgent
    ]);
  } catch (error) {
    console.error('Error inserting audit log:', error);
  }
};

// Middleware para capturar valores anteriores antes de actualizar
const captureOldValues = (tableName, idField = 'id') => {
  return async (req, res, next) => {
    try {
      const recordId = req.params[idField] || req.params.id;
      if (recordId) {
        const [rows] = await pool.execute(
          `SELECT * FROM ${tableName} WHERE ${idField} = ?`,
          [recordId]
        );
        
        if (rows.length > 0) {
          req.auditOldValues = rows[0];
        }
      }
    } catch (error) {
      console.error('Error capturing old values:', error);
    }
    next();
  };
};

// Middleware para validar archivos subidos
const validateFileUpload = (allowedTypes = [], maxSize = null) => {
  return (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No se ha subido ningún archivo'
      });
    }

    // Validar tipo de archivo
    if (allowedTypes.length > 0 && !allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: `Tipo de archivo no permitido. Tipos permitidos: ${allowedTypes.join(', ')}`
      });
    }

    // Validar tamaño
    const fileSizeLimit = maxSize || parseInt(process.env.MAX_FILE_SIZE) || 10485760; // 10MB por defecto
    if (req.file.size > fileSizeLimit) {
      return res.status(400).json({
        success: false,
        message: `El archivo es demasiado grande. Tamaño máximo: ${fileSizeLimit / 1024 / 1024}MB`
      });
    }

    next();
  };
};

module.exports = {
  loginLimiter,
  apiLimiter,
  auditLogger,
  logAuditEvent,
  captureOldValues,
  validateFileUpload
};