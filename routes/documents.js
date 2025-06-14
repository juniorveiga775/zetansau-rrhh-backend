const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin, requireOwnershipOrAdmin } = require('../middleware/auth');
const { auditLogger, validateFileUpload } = require('../middleware/security');

const router = express.Router();

// Configuración de multer para subida de archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    const fullPath = path.join(uploadPath, 'documents');
    
    // Crear directorio si no existe
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
    
    cb(null, fullPath);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const originalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${timestamp}_${originalName}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 // 10MB
  },
  fileFilter: (req, file, cb) => {
    // Solo permitir PDFs
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF'), false);
    }
  }
});

// Validaciones
const uploadDocumentValidation = [
  body('userId').isInt().withMessage('ID de usuario inválido'),
  body('type').isIn(['payroll', 'contract']).withMessage('Tipo de documento inválido'),
  body('title').isLength({ min: 3 }).withMessage('Título debe tener al menos 3 caracteres'),
  body('monthYear').optional().matches(/^\d{4}-\d{2}$/).withMessage('Formato de mes/año inválido (YYYY-MM)')
];

// GET /api/documents - Obtener documentos del usuario
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { type, monthYear, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    
    let whereClause = 'WHERE (d.user_id = ? OR d.user_id IS NULL)';
    const queryParams = [req.user.id];

    // Si es admin, puede ver documentos de todos los usuarios
    if (req.user.role === 'admin') {
      if (req.query.userId) {
        whereClause = 'WHERE d.user_id = ?';
        queryParams[0] = req.query.userId;
      } else {
        whereClause = 'WHERE 1=1'; // Ver todos los documentos
        queryParams.length = 0;
      }
    }

    // Filtros
    if (type) {
      whereClause += ' AND d.type = ?';
      queryParams.push(type);
    }

    if (monthYear) {
      whereClause += ' AND d.month_year = ?';
      queryParams.push(monthYear);
    }

    // Obtener documentos
    const [documents] = await pool.execute(
      `SELECT d.id, d.type, d.title, d.file_name, d.file_size, d.month_year, d.created_at,
              u.first_name, u.last_name, uploader.first_name as uploaded_by_name
       FROM documents d
       LEFT JOIN users u ON d.user_id = u.id
       JOIN users uploader ON d.uploaded_by = uploader.id
       ${whereClause}
       ORDER BY d.created_at DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, parseInt(limit), parseInt(offset)]
    );

    // Obtener total de documentos
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM documents d ${whereClause}`,
      queryParams
    );
    const total = countResult[0].total;

    res.json({
      success: true,
      data: {
        documents,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Error obteniendo documentos:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// GET /api/documents/:id - Obtener documento específico
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const documentId = req.params.id;

    const [documents] = await pool.execute(
      `SELECT d.*, u.first_name, u.last_name
       FROM documents d
       JOIN users u ON d.user_id = u.id
       WHERE d.id = ?`,
      [documentId]
    );

    if (documents.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    const document = documents[0];

    // Verificar permisos
    if (req.user.role !== 'admin' && document.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'No tienes permisos para acceder a este documento'
      });
    }

    res.json({
      success: true,
      data: { document }
    });

  } catch (error) {
    console.error('Error obteniendo documento:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// GET /api/documents/:id/download - Descargar documento
router.get('/:id/download', authenticateToken, auditLogger('DOWNLOAD_DOCUMENT', 'documents'), async (req, res) => {
  try {
    const documentId = req.params.id;

    // Obtener documento con información del usuario
    const [documents] = await pool.execute(
      `SELECT d.*, u.first_name, u.last_name, pr.id as payroll_record_id
       FROM documents d
       LEFT JOIN users u ON d.user_id = u.id
       LEFT JOIN payroll_records pr ON d.user_id = pr.user_id AND d.month_year = pr.month_year AND d.type = 'payroll'
       WHERE d.id = ?`,
      [documentId]
    );

    if (documents.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    const document = documents[0];

    // Verificar permisos
    if (req.user.role !== 'admin' && document.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'No tienes permisos para descargar este documento'
      });
    }

    const filePath = path.resolve(document.file_path);

    // Verificar que el archivo existe
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Archivo no encontrado en el servidor'
      });
    }

    // Generar nombre de archivo personalizado para nóminas
    let downloadFileName = document.file_name;
    if (document.type === 'payroll' && document.first_name && document.last_name && document.month_year) {
      const [year, month] = document.month_year.split('-');
      const monthNames = {
        '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
        '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
        '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
      };
      const monthName = monthNames[month] || month;
      downloadFileName = `Nomina_${document.first_name}_${document.last_name}_${monthName}_${year}.pdf`;
    }

    // Registrar descarga si es una nómina
    if (document.type === 'payroll' && document.payroll_record_id) {
      try {
        await pool.execute(
          `INSERT INTO payroll_downloads (user_id, payroll_record_id, document_id, download_type, ip_address, user_agent)
           VALUES (?, ?, ?, 'download', ?, ?)`,
          [
            req.user.id,
            document.payroll_record_id,
            documentId,
            req.ip || req.connection.remoteAddress,
            req.get('User-Agent') || ''
          ]
        );
      } catch (downloadLogError) {
        console.error('Error registrando descarga de nómina:', downloadLogError);
        // No interrumpir la descarga por error en el log
      }
    }

    // Configurar headers para descarga
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFileName}"`);
    
    // Enviar archivo
    res.sendFile(filePath);

  } catch (error) {
    console.error('Error descargando documento:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// POST /api/documents/upload - Subir documento (solo admin)
router.post('/upload', authenticateToken, requireAdmin, upload.single('document'), 
  validateFileUpload(['application/pdf']), uploadDocumentValidation, 
  auditLogger('UPLOAD_DOCUMENT', 'documents'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Eliminar archivo subido si hay errores de validación
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        errors: errors.array()
      });
    }

    const { userId, type, title, monthYear } = req.body;

    // Si es 'all', es un documento general (sin usuario específico)
    let targetUserId = null;
    if (userId !== 'all') {
      // Verificar que el usuario existe
      const [users] = await pool.execute(
        'SELECT id, first_name, last_name FROM users WHERE id = ? AND role = "employee"',
        [userId]
      );

      if (users.length === 0) {
        // Eliminar archivo subido
        if (req.file) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(404).json({
          success: false,
          message: 'Usuario no encontrado'
        });
      }
      targetUserId = userId;
    }

    // Para nóminas, verificar que no exista ya una para ese mes/año (solo si es para un usuario específico)
    if (type === 'payroll' && monthYear && targetUserId) {
      const [existing] = await pool.execute(
        'SELECT id FROM documents WHERE user_id = ? AND type = "payroll" AND month_year = ?',
        [targetUserId, monthYear]
      );

      if (existing.length > 0) {
        // Eliminar archivo subido
        if (req.file) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({
          success: false,
          message: 'Ya existe una nómina para este mes/año'
        });
      }
    }

    // Guardar información del documento en la base de datos
    const [result] = await pool.execute(
      `INSERT INTO documents (user_id, type, title, file_name, file_path, file_size, month_year, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        targetUserId,
        type,
        title,
        req.file.originalname,
        req.file.path,
        req.file.size,
        monthYear || null,
        req.user.id
      ]
    );

    const documentId = result.insertId;

    // Obtener el documento creado
    const [newDocument] = await pool.execute(
      `SELECT d.*, u.first_name, u.last_name
       FROM documents d
       LEFT JOIN users u ON d.user_id = u.id
       WHERE d.id = ?`,
      [documentId]
    );

    res.status(201).json({
      success: true,
      message: 'Documento subido correctamente',
      data: { document: newDocument[0] }
    });

  } catch (error) {
    console.error('Error subiendo documento:', error);
    
    // Eliminar archivo subido en caso de error
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('Error eliminando archivo:', unlinkError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// PUT /api/documents/:id - Actualizar documento (solo admin)
router.put('/:id', authenticateToken, requireAdmin, upload.single('document'),
  auditLogger('UPDATE_DOCUMENT', 'documents'), async (req, res) => {
  try {
    const documentId = req.params.id;
    const { title, type, description } = req.body;

    // Verificar que el documento existe
    const [documents] = await pool.execute(
      'SELECT * FROM documents WHERE id = ?',
      [documentId]
    );

    if (documents.length === 0) {
      // Eliminar archivo subido si hay errores
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    const document = documents[0];
    let updateFields = [];
    let updateValues = [];

    // Actualizar campos de texto
    if (title) {
      updateFields.push('title = ?');
      updateValues.push(title);
    }
    if (type) {
      updateFields.push('type = ?');
      updateValues.push(type);
    }

    // Si se subió un nuevo archivo, actualizar información del archivo
    if (req.file) {
      // Eliminar archivo anterior
      try {
        if (fs.existsSync(document.file_path)) {
          fs.unlinkSync(document.file_path);
        }
      } catch (fileError) {
        console.error('Error eliminando archivo anterior:', fileError);
      }

      updateFields.push('file_name = ?', 'file_path = ?', 'file_size = ?');
      updateValues.push(req.file.originalname, req.file.path, req.file.size);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No hay campos para actualizar'
      });
    }

    // Actualizar documento en la base de datos
    updateValues.push(documentId);
    await pool.execute(
      `UPDATE documents SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    // Obtener el documento actualizado
    const [updatedDocument] = await pool.execute(
      `SELECT d.*, u.first_name, u.last_name
       FROM documents d
       LEFT JOIN users u ON d.user_id = u.id
       WHERE d.id = ?`,
      [documentId]
    );

    res.json({
      success: true,
      message: 'Documento actualizado correctamente',
      data: { document: updatedDocument[0] }
    });

  } catch (error) {
    console.error('Error actualizando documento:', error);
    
    // Eliminar archivo subido en caso de error
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('Error eliminando archivo:', unlinkError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// DELETE /api/documents/:id - Eliminar documento (solo admin)
router.delete('/:id', authenticateToken, requireAdmin, 
  auditLogger('DELETE_DOCUMENT', 'documents'), async (req, res) => {
  try {
    const documentId = req.params.id;

    // Obtener información del documento
    const [documents] = await pool.execute(
      'SELECT * FROM documents WHERE id = ?',
      [documentId]
    );

    if (documents.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    const document = documents[0];

    // Eliminar archivo del sistema de archivos
    try {
      if (fs.existsSync(document.file_path)) {
        fs.unlinkSync(document.file_path);
      }
    } catch (fileError) {
      console.error('Error eliminando archivo:', fileError);
    }

    // Eliminar registro de la base de datos
    await pool.execute('DELETE FROM documents WHERE id = ?', [documentId]);

    res.json({
      success: true,
      message: 'Documento eliminado correctamente'
    });

  } catch (error) {
    console.error('Error eliminando documento:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// GET /api/documents/:id/view - Visualizar documento
router.get('/:id/view', authenticateToken, auditLogger('VIEW_DOCUMENT', 'documents'), async (req, res) => {
  try {
    const documentId = req.params.id;

    // Obtener documento con información del usuario
    const [documents] = await pool.execute(
      `SELECT d.*, u.first_name, u.last_name, pr.id as payroll_record_id
       FROM documents d
       LEFT JOIN users u ON d.user_id = u.id
       LEFT JOIN payroll_records pr ON d.user_id = pr.user_id AND d.month_year = pr.month_year AND d.type = 'payroll'
       WHERE d.id = ?`,
      [documentId]
    );

    if (documents.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    const document = documents[0];

    // Verificar permisos
    if (req.user.role !== 'admin' && document.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'No tienes permisos para visualizar este documento'
      });
    }

    const filePath = path.resolve(document.file_path);

    // Verificar que el archivo existe
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Archivo no encontrado en el servidor'
      });
    }

    // Registrar visualización si es una nómina
    if (document.type === 'payroll' && document.payroll_record_id) {
      try {
        await pool.execute(
          `INSERT INTO payroll_downloads (user_id, payroll_record_id, document_id, download_type, ip_address, user_agent)
           VALUES (?, ?, ?, 'view', ?, ?)`,
          [
            req.user.id,
            document.payroll_record_id,
            documentId,
            req.ip || req.connection.remoteAddress,
            req.get('User-Agent') || ''
          ]
        );
      } catch (viewLogError) {
        console.error('Error registrando visualización de nómina:', viewLogError);
        // No interrumpir la visualización por error en el log
      }
    }

    // Configurar headers para visualización
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    
    // Enviar archivo para visualización
    res.sendFile(filePath);

  } catch (error) {
    console.error('Error visualizando documento:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// GET /api/documents/user/:userId - Obtener documentos de un usuario específico (solo admin)
router.get('/user/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;
    const { type } = req.query;

    let whereClause = 'WHERE d.user_id = ?';
    const queryParams = [userId];

    if (type) {
      whereClause += ' AND d.type = ?';
      queryParams.push(type);
    }

    const [documents] = await pool.execute(
      `SELECT d.id, d.type, d.title, d.file_name, d.file_size, d.month_year, d.created_at,
              uploader.first_name as uploaded_by_name
       FROM documents d
       JOIN users uploader ON d.uploaded_by = uploader.id
       ${whereClause}
       ORDER BY d.created_at DESC`,
      queryParams
    );

    res.json({
      success: true,
      data: { documents }
    });

  } catch (error) {
    console.error('Error obteniendo documentos del usuario:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

module.exports = router;