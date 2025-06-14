const express = require('express');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin, requireOwnershipOrAdmin } = require('../middleware/auth');
const { auditLogger, captureOldValues } = require('../middleware/security');
const nodemailer = require('nodemailer');

const router = express.Router();

// Configuración de nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Validaciones
const createRequestValidation = [
  body('type').isIn(['permission', 'vacation', 'sick_leave']).withMessage('Tipo de solicitud inválido'),
  body('startDate').isISO8601().withMessage('Fecha de inicio inválida'),
  body('endDate').isISO8601().withMessage('Fecha de fin inválida'),
  body('reason').isLength({ min: 10, max: 500 }).withMessage('La razón debe tener entre 10 y 500 caracteres')
];

const reviewRequestValidation = [
  body('status').isIn(['approved', 'rejected']).withMessage('Estado inválido'),
  body('adminComment').optional().isLength({ max: 500 }).withMessage('Comentario muy largo')
];

// Función para calcular días laborables
const calculateWorkingDays = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  let workingDays = 0;
  
  const currentDate = new Date(start);
  while (currentDate <= end) {
    const dayOfWeek = currentDate.getDay();
    // 0 = Domingo, 6 = Sábado
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      workingDays++;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return workingDays;
};

// Función para enviar notificación por email
const sendNotificationEmail = async (userEmail, userName, requestType, status, adminComment = '') => {
  try {
    const typeNames = {
      permission: 'Permiso',
      vacation: 'Vacaciones',
      sick_leave: 'Baja médica'
    };

    const statusNames = {
      approved: 'Aprobada',
      rejected: 'Rechazada'
    };

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: userEmail,
      subject: `Solicitud de ${typeNames[requestType]} - ${statusNames[status]}`,
      html: `
        <h2>Estado de tu solicitud</h2>
        <p>Hola ${userName},</p>
        <p>Tu solicitud de <strong>${typeNames[requestType]}</strong> ha sido <strong>${statusNames[status].toLowerCase()}</strong>.</p>
        ${adminComment ? `<p><strong>Comentario del administrador:</strong> ${adminComment}</p>` : ''}
        <br>
        <p>Puedes revisar el estado de todas tus solicitudes en el portal de RRHH.</p>
      `
    };

    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('Error enviando email de notificación:', error);
  }
};

// GET /api/requests - Obtener solicitudes
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, type, page = 1, limit = 10, userId } = req.query;
    const offset = (page - 1) * limit;
    
    let whereClause = '';
    const queryParams = [];

    // Si es empleado, solo ver sus propias solicitudes
    if (req.user.role === 'employee') {
      whereClause = 'WHERE r.user_id = ?';
      queryParams.push(req.user.id);
    } else if (req.user.role === 'admin') {
      // Si es admin y especifica userId, filtrar por ese usuario
      if (userId) {
        whereClause = 'WHERE r.user_id = ?';
        queryParams.push(userId);
      }
    }

    // Filtros adicionales
    if (status) {
      whereClause += whereClause ? ' AND' : 'WHERE';
      whereClause += ' r.status = ?';
      queryParams.push(status);
    }

    if (type) {
      whereClause += whereClause ? ' AND' : 'WHERE';
      whereClause += ' r.type = ?';
      queryParams.push(type);
    }

    // Obtener solicitudes
    const [requests] = await pool.execute(
      `SELECT r.id, r.type, r.start_date, r.end_date, r.days_requested, r.reason, 
              r.status, r.admin_comment, r.created_at, r.reviewed_at,
              u.first_name, u.last_name, u.email,
              reviewer.first_name as reviewer_first_name, reviewer.last_name as reviewer_last_name
       FROM requests r
       JOIN users u ON r.user_id = u.id
       LEFT JOIN users reviewer ON r.reviewed_by = reviewer.id
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, parseInt(limit), parseInt(offset)]
    );

    // Obtener total de solicitudes
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM requests r
       JOIN users u ON r.user_id = u.id
       ${whereClause}`,
      queryParams
    );
    const total = countResult[0].total;

    res.json({
      success: true,
      data: {
        requests,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Error obteniendo solicitudes:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// GET /api/requests/:id - Obtener solicitud específica
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const requestId = req.params.id;

    const [requests] = await pool.execute(
      `SELECT r.*, u.first_name, u.last_name, u.email,
              reviewer.first_name as reviewer_first_name, reviewer.last_name as reviewer_last_name
       FROM requests r
       JOIN users u ON r.user_id = u.id
       LEFT JOIN users reviewer ON r.reviewed_by = reviewer.id
       WHERE r.id = ?`,
      [requestId]
    );

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Solicitud no encontrada'
      });
    }

    const request = requests[0];

    // Verificar permisos
    if (req.user.role !== 'admin' && request.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'No tienes permisos para ver esta solicitud'
      });
    }

    res.json({
      success: true,
      data: { request }
    });

  } catch (error) {
    console.error('Error obteniendo solicitud:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// POST /api/requests - Crear nueva solicitud
router.post('/', authenticateToken, createRequestValidation, auditLogger('CREATE_REQUEST', 'requests'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        errors: errors.array()
      });
    }

    const { type, startDate, endDate, reason } = req.body;
    const userId = req.user.id;

    // Validar fechas
    const start = new Date(startDate);
    const end = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (start < today) {
      return res.status(400).json({
        success: false,
        message: 'La fecha de inicio no puede ser anterior a hoy'
      });
    }

    if (end < start) {
      return res.status(400).json({
        success: false,
        message: 'La fecha de fin no puede ser anterior a la fecha de inicio'
      });
    }

    // Calcular días solicitados
    const daysRequested = calculateWorkingDays(startDate, endDate);

    if (daysRequested === 0) {
      return res.status(400).json({
        success: false,
        message: 'El período seleccionado no incluye días laborables'
      });
    }

    // Verificar solapamiento con otras solicitudes aprobadas
    const [overlapping] = await pool.execute(
      `SELECT id FROM requests 
       WHERE user_id = ? AND status = 'approved' 
       AND ((start_date <= ? AND end_date >= ?) OR (start_date <= ? AND end_date >= ?))
       AND ((start_date BETWEEN ? AND ?) OR (end_date BETWEEN ? AND ?))`,
      [userId, startDate, startDate, endDate, endDate, startDate, endDate, startDate, endDate]
    );

    if (overlapping.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Ya tienes una solicitud aprobada que se solapa con estas fechas'
      });
    }

    // Crear solicitud
    const [result] = await pool.execute(
      `INSERT INTO requests (user_id, type, start_date, end_date, days_requested, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, type, startDate, endDate, daysRequested, reason]
    );

    const requestId = result.insertId;

    // Obtener la solicitud creada
    const [newRequest] = await pool.execute(
      `SELECT r.*, u.first_name, u.last_name
       FROM requests r
       JOIN users u ON r.user_id = u.id
       WHERE r.id = ?`,
      [requestId]
    );

    res.status(201).json({
      success: true,
      message: 'Solicitud creada correctamente',
      data: { request: newRequest[0] }
    });

  } catch (error) {
    console.error('Error creando solicitud:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// PUT /api/requests/:id/review - Revisar solicitud (solo admin)
router.put('/:id/review', authenticateToken, requireAdmin, reviewRequestValidation,
  captureOldValues('requests'), auditLogger('REVIEW_REQUEST', 'requests'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        errors: errors.array()
      });
    }

    const requestId = req.params.id;
    const { status, adminComment } = req.body;
    const reviewerId = req.user.id;

    // Verificar que la solicitud existe y está pendiente
    const [requests] = await pool.execute(
      `SELECT r.*, u.first_name, u.last_name, u.email
       FROM requests r
       JOIN users u ON r.user_id = u.id
       WHERE r.id = ? AND r.status = 'pending'`,
      [requestId]
    );

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Solicitud no encontrada o ya ha sido revisada'
      });
    }

    const request = requests[0];

    // Actualizar solicitud
    await pool.execute(
      `UPDATE requests 
       SET status = ?, admin_comment = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, adminComment, reviewerId, requestId]
    );

    // Enviar notificación por email
    await sendNotificationEmail(
      request.email,
      `${request.first_name} ${request.last_name}`,
      request.type,
      status,
      adminComment
    );

    // Obtener solicitud actualizada
    const [updatedRequest] = await pool.execute(
      `SELECT r.*, u.first_name, u.last_name,
              reviewer.first_name as reviewer_first_name, reviewer.last_name as reviewer_last_name
       FROM requests r
       JOIN users u ON r.user_id = u.id
       LEFT JOIN users reviewer ON r.reviewed_by = reviewer.id
       WHERE r.id = ?`,
      [requestId]
    );

    const statusText = status === 'approved' ? 'aprobada' : 'rechazada';

    res.json({
      success: true,
      message: `Solicitud ${statusText} correctamente`,
      data: { request: updatedRequest[0] }
    });

  } catch (error) {
    console.error('Error revisando solicitud:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// DELETE /api/requests/:id - Eliminar solicitud (solo el propietario y solo si está pendiente)
router.delete('/:id', authenticateToken, auditLogger('DELETE_REQUEST', 'requests'), async (req, res) => {
  try {
    const requestId = req.params.id;
    const userId = req.user.id;

    // Verificar que la solicitud existe, pertenece al usuario y está pendiente
    let whereClause = 'WHERE id = ? AND status = "pending"';
    let queryParams = [requestId];

    if (req.user.role !== 'admin') {
      whereClause += ' AND user_id = ?';
      queryParams.push(userId);
    }

    const [requests] = await pool.execute(
      `SELECT * FROM requests ${whereClause}`,
      queryParams
    );

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Solicitud no encontrada, ya revisada o no tienes permisos para eliminarla'
      });
    }

    // Eliminar solicitud
    await pool.execute('DELETE FROM requests WHERE id = ?', [requestId]);

    res.json({
      success: true,
      message: 'Solicitud eliminada correctamente'
    });

  } catch (error) {
    console.error('Error eliminando solicitud:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// GET /api/requests/stats/summary - Estadísticas de solicitudes (solo admin)
router.get('/stats/summary', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Solicitudes por estado
    const [statusStats] = await pool.execute(
      `SELECT status, COUNT(*) as count
       FROM requests
       GROUP BY status`
    );

    // Solicitudes por tipo
    const [typeStats] = await pool.execute(
      `SELECT type, COUNT(*) as count
       FROM requests
       GROUP BY type`
    );

    // Solicitudes del mes actual
    const [monthlyStats] = await pool.execute(
      `SELECT COUNT(*) as total
       FROM requests
       WHERE YEAR(created_at) = YEAR(CURRENT_DATE) AND MONTH(created_at) = MONTH(CURRENT_DATE)`
    );

    // Solicitudes pendientes por usuario
    const [pendingByUser] = await pool.execute(
      `SELECT u.first_name, u.last_name, COUNT(r.id) as pending_count
       FROM users u
       LEFT JOIN requests r ON u.id = r.user_id AND r.status = 'pending'
       WHERE u.role = 'employee'
       GROUP BY u.id, u.first_name, u.last_name
       HAVING pending_count > 0
       ORDER BY pending_count DESC`
    );

    res.json({
      success: true,
      data: {
        statusStats,
        typeStats,
        monthlyTotal: monthlyStats[0].total,
        pendingByUser
      }
    });

  } catch (error) {
    console.error('Error obteniendo estadísticas de solicitudes:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

module.exports = router;