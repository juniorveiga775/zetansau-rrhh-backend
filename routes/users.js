const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin, requireOwnershipOrAdmin } = require('../middleware/auth');
const { auditLogger, captureOldValues } = require('../middleware/security');
const { sendWelcomeEmail, verifyEmailConnection } = require('../services/emailService');

const router = express.Router();

// Validaciones
const createUserValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('firstName').isLength({ min: 2 }).withMessage('Nombre debe tener al menos 2 caracteres'),
  body('lastName').isLength({ min: 2 }).withMessage('Apellido debe tener al menos 2 caracteres'),
  body('birthDate').optional().isISO8601().withMessage('Fecha de nacimiento inválida'),
  body('dni').isLength({ min: 8 }).withMessage('DNI/NIE inválido'),
  body('dniExpiryDate').optional().isISO8601().withMessage('Fecha de caducidad DNI/NIE inválida'),
  body('position').optional().isLength({ min: 2 }).withMessage('Cargo inválido'),
  body('department').optional().isLength({ min: 2 }).withMessage('Departamento inválido'),
  body('branch').optional().isIn(['madrid', 'barcelona']).withMessage('Sucursal debe ser madrid o barcelona'),
  body('salary').optional().isNumeric().withMessage('Salario debe ser numérico'),
  body('hireDate').optional().isISO8601().withMessage('Fecha de contratación inválida'),
  body('drivingLicense').optional().isLength({ min: 2 }).withMessage('Carnet de conducir inválido'),
  body('drivingLicenseExpiryDate').optional().isISO8601().withMessage('Fecha de caducidad del carnet inválida'),
  body('bankAccount').optional().isLength({ min: 15 }).withMessage('Cuenta bancaria inválida'),
  body('address').optional().isLength({ min: 5 }).withMessage('Dirección inválida'),
  body('emergencyPhone').optional().isMobilePhone().withMessage('Teléfono de emergencia inválido')
];

const updateUserValidation = [
  body('email').optional().isEmail().normalizeEmail().withMessage('Email inválido'),
  body('firstName').optional().isLength({ min: 2 }).withMessage('Nombre debe tener al menos 2 caracteres'),
  body('lastName').optional().isLength({ min: 2 }).withMessage('Apellido debe tener al menos 2 caracteres'),
  body('birthDate').optional().isISO8601().withMessage('Fecha de nacimiento inválida'),
  body('dni').optional().isLength({ min: 8 }).withMessage('DNI/NIE inválido'),
  body('dniExpiryDate').optional().isISO8601().withMessage('Fecha de caducidad DNI/NIE inválida'),
  body('position').optional().isLength({ min: 2 }).withMessage('Cargo inválido'),
  body('department').optional().isLength({ min: 2 }).withMessage('Departamento inválido'),
  body('branch').optional().isIn(['madrid', 'barcelona']).withMessage('Sucursal debe ser madrid o barcelona'),
  body('salary').optional().isNumeric().withMessage('Salario debe ser numérico'),
  body('hireDate').optional().isISO8601().withMessage('Fecha de contratación inválida'),
  body('drivingLicense').optional().isLength({ min: 2 }).withMessage('Carnet de conducir inválido'),
  body('drivingLicenseExpiryDate').optional().isISO8601().withMessage('Fecha de caducidad del carnet inválida'),
  body('bankAccount').optional().isLength({ min: 15 }).withMessage('Cuenta bancaria inválida'),
  body('address').optional().isLength({ min: 5 }).withMessage('Dirección inválida'),
  body('emergencyPhone').optional().isMobilePhone().withMessage('Teléfono de emergencia inválido'),
  body('status').optional().isIn(['active', 'inactive']).withMessage('Estado inválido')
];

// GET /api/users - Obtener lista de usuarios (solo admin)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', department = '', status = '' } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE role = "employee"';
    const queryParams = [];

    // Filtros
    if (search) {
      whereClause += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR dni LIKE ?)';
      const searchTerm = `%${search}%`;
      queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (department) {
      whereClause += ' AND department = ?';
      queryParams.push(department);
    }

    if (status) {
      whereClause += ' AND status = ?';
      queryParams.push(status);
    }

    // Obtener total de registros
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM users ${whereClause}`,
      queryParams
    );
    const total = countResult[0].total;

    // Obtener usuarios paginados
    const [users] = await pool.execute(
      `SELECT id, email, first_name, last_name, birth_date, dni, dni_expiry_date, phone, position, department, 
              branch, salary, hire_date, driving_license, driving_license_expiry_date, bank_account, 
              address, emergency_phone, status, created_at, updated_at
       FROM users ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, parseInt(limit), parseInt(offset)]
    );

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// GET /api/users/:id - Obtener usuario específico
router.get('/:id', authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    const [users] = await pool.execute(
      `SELECT id, email, first_name, last_name, birth_date, dni, phone, position, department,
              branch, ${req.user.role === 'admin' ? 'salary,' : ''}
              hire_date, status, created_at, updated_at
       FROM users WHERE id = ?`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    res.json({
      success: true,
      data: { user: users[0] }
    });

  } catch (error) {
    console.error('Error obteniendo usuario:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// POST /api/users - Crear nuevo usuario (solo admin)
router.post('/', authenticateToken, requireAdmin, createUserValidation, auditLogger('CREATE_USER', 'users'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        errors: errors.array()
      });
    }

    const {
      email,
      firstName,
      lastName,
      birthDate,
      dni,
      dniExpiryDate,
      phone,
      position,
      department,
      branch,
      salary,
      hireDate,
      drivingLicense,
      drivingLicenseExpiryDate,
      bankAccount,
      address,
      emergencyPhone
    } = req.body;

    // Verificar si el email o DNI ya existen
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE email = ? OR dni = ?',
      [email, dni]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'El email o DNI ya están registrados'
      });
    }

    // Generar token temporal para configuración de contraseña
    const crypto = require('crypto');
    const setupToken = crypto.randomBytes(32).toString('hex');
    const setupTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas
    
    // Contraseña temporal (será reemplazada cuando el usuario configure su contraseña)
    const tempPassword = crypto.randomBytes(16).toString('hex');
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    // Crear usuario
    const [result] = await pool.execute(
      `INSERT INTO users (email, password, first_name, last_name, birth_date, dni, dni_expiry_date, phone, position, 
                         department, branch, salary, hire_date, driving_license, driving_license_expiry_date, 
                         bank_account, address, emergency_phone, first_login, setup_token, setup_token_expiry)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?)`,
      [email, hashedPassword, firstName, lastName, birthDate, dni, dniExpiryDate, phone, position, department, 
       branch, salary, hireDate, drivingLicense, drivingLicenseExpiryDate, bankAccount, address, emergencyPhone, setupToken, setupTokenExpiry]
    );

    const newUserId = result.insertId;

    // Obtener el usuario creado
    const [newUser] = await pool.execute(
      `SELECT id, email, first_name, last_name, birth_date, dni, dni_expiry_date, phone, position, department,
              branch, salary, hire_date, driving_license, driving_license_expiry_date, bank_account, 
              address, emergency_phone, status, created_at
       FROM users WHERE id = ?`,
      [newUserId]
    );

    // Enviar email de bienvenida con token de configuración
    try {
      await sendWelcomeEmail(firstName, lastName, email, setupToken);
      console.log(`Email de bienvenida enviado a: ${email}`);
    } catch (emailError) {
      console.error('Error enviando email de bienvenida:', emailError);
      // No fallar la operación si el email falla
    }

    res.status(201).json({
      success: true,
      message: 'Usuario creado correctamente. Se ha enviado un email con instrucciones para configurar la contraseña.',
      data: { 
        user: newUser[0]
      }
    });

  } catch (error) {
    console.error('Error creando usuario:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'El email o DNI ya están registrados'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// PUT /api/users/:id - Actualizar usuario
router.put('/:id', authenticateToken, requireOwnershipOrAdmin, updateUserValidation, 
  captureOldValues('users'), auditLogger('UPDATE_USER', 'users'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        errors: errors.array()
      });
    }

    const userId = req.params.id;
    const updateData = req.body;

    // Solo admin puede cambiar ciertos campos
    if (req.user.role !== 'admin') {
      delete updateData.salary;
      delete updateData.status;
      delete updateData.position;
      delete updateData.department;
      delete updateData.hireDate;
      delete updateData.branch;
    }

    // Construir query dinámicamente
    const updateFields = [];
    const updateValues = [];

    Object.keys(updateData).forEach(key => {
      const dbField = key === 'firstName' ? 'first_name' :
                     key === 'lastName' ? 'last_name' :
                     key === 'birthDate' ? 'birth_date' :
                     key === 'hireDate' ? 'hire_date' :
                     key === 'dniExpiryDate' ? 'dni_expiry_date' :
                     key === 'drivingLicense' ? 'driving_license' :
                     key === 'drivingLicenseExpiryDate' ? 'driving_license_expiry_date' :
                     key === 'bankAccount' ? 'bank_account' :
                     key === 'emergencyPhone' ? 'emergency_phone' : key;
      
      updateFields.push(`${dbField} = ?`);
      updateValues.push(updateData[key]);
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No hay campos para actualizar'
      });
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(userId);

    // Verificar si el usuario existe
    const [existingUser] = await pool.execute(
      'SELECT id FROM users WHERE id = ?',
      [userId]
    );

    if (existingUser.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    // Actualizar usuario
    await pool.execute(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    // Obtener usuario actualizado
    const [updatedUser] = await pool.execute(
      `SELECT id, email, first_name, last_name, birth_date, dni, dni_expiry_date, phone, position, department,
              branch, ${req.user.role === 'admin' ? 'salary,' : ''}
              hire_date, driving_license, driving_license_expiry_date, bank_account, 
              address, emergency_phone, status, updated_at
       FROM users WHERE id = ?`,
      [userId]
    );

    res.json({
      success: true,
      message: 'Usuario actualizado correctamente',
      data: { user: updatedUser[0] }
    });

  } catch (error) {
    console.error('Error actualizando usuario:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'El email o DNI ya están registrados'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// DELETE /api/users/:id - Eliminar usuario (solo admin)
router.delete('/:id', authenticateToken, requireAdmin, 
  captureOldValues('users'), auditLogger('DELETE_USER', 'users'), async (req, res) => {
  try {
    const userId = req.params.id;

    // Verificar que no sea el propio admin
    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'No puedes eliminar tu propia cuenta'
      });
    }

    // Verificar si el usuario existe
    const [existingUser] = await pool.execute(
      'SELECT id, first_name, last_name FROM users WHERE id = ? AND role = "employee"',
      [userId]
    );

    if (existingUser.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    // Eliminar usuario (esto también eliminará documentos y solicitudes por CASCADE)
    await pool.execute('DELETE FROM users WHERE id = ?', [userId]);

    res.json({
      success: true,
      message: `Usuario ${existingUser[0].first_name} ${existingUser[0].last_name} eliminado correctamente`
    });

  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// POST /api/users/:id/reset-password - Resetear contraseña de usuario (solo admin)
router.post('/:id/reset-password', authenticateToken, requireAdmin, 
  auditLogger('RESET_USER_PASSWORD', 'users'), async (req, res) => {
  try {
    const userId = req.params.id;

    // Obtener información del usuario
    const [users] = await pool.execute(
      'SELECT dni, first_name, last_name, email FROM users WHERE id = ? AND role = "employee"',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    const user = users[0];
    
    // Resetear contraseña al DNI
    const newPassword = user.dni;
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await pool.execute(
      'UPDATE users SET password = ?, first_login = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [hashedPassword, userId]
    );

    res.json({
      success: true,
      message: `Contraseña de ${user.first_name} ${user.last_name} restablecida a su DNI`,
      data: {
        newPassword: newPassword,
        email: user.email
      }
    });

  } catch (error) {
    console.error('Error reseteando contraseña:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// GET /api/users/stats/dashboard - Estadísticas para dashboard (solo admin)
router.get('/stats/dashboard', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Total de empleados
    const [totalEmployees] = await pool.execute(
      'SELECT COUNT(*) as total FROM users WHERE role = "employee"'
    );

    // Empleados activos
    const [activeEmployees] = await pool.execute(
      'SELECT COUNT(*) as total FROM users WHERE role = "employee" AND status = "active"'
    );

    // Solicitudes pendientes
    const [pendingRequests] = await pool.execute(
      'SELECT COUNT(*) as total FROM requests WHERE status = "pending"'
    );

    // Empleados por departamento
    const [departmentStats] = await pool.execute(
      `SELECT department, COUNT(*) as count 
       FROM users 
       WHERE role = "employee" AND status = "active" AND department IS NOT NULL
       GROUP BY department
       ORDER BY count DESC`
    );

    res.json({
      success: true,
      data: {
        totalEmployees: totalEmployees[0].total,
        activeEmployees: activeEmployees[0].total,
        inactiveEmployees: totalEmployees[0].total - activeEmployees[0].total,
        pendingRequests: pendingRequests[0].total,
        departmentStats
      }
    });

  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// POST /api/users/test-email - Verificar conexión de email y enviar email de prueba (solo admin)
router.post('/test-email', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { testEmail } = req.body;
    
    // Verificar conexión del transporter
    console.log('🔍 Verificando conexión de email...');
    const connectionResult = await verifyEmailConnection();
    
    if (!connectionResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Error en la conexión de email',
        error: connectionResult.error,
        details: {
          host: process.env.EMAIL_HOST,
          port: process.env.EMAIL_PORT,
          user: process.env.EMAIL_USER,
          from: process.env.EMAIL_FROM
        }
      });
    }
    
    // Si se proporciona un email de prueba, enviar email
    if (testEmail) {
      console.log(`📧 Enviando email de prueba a: ${testEmail}`);
      const emailResult = await sendWelcomeEmail('Usuario', 'Prueba', testEmail, 'test-token-123');
      
      if (!emailResult.success) {
        return res.status(500).json({
          success: false,
          message: 'Error enviando email de prueba',
          error: emailResult.error,
          connectionVerified: true
        });
      }
      
      return res.json({
        success: true,
        message: 'Email de prueba enviado correctamente',
        connectionVerified: true,
        testEmailSent: true,
        sentTo: testEmail
      });
    }
    
    // Solo verificación de conexión
    res.json({
      success: true,
      message: 'Conexión de email verificada correctamente',
      connectionVerified: true,
      config: {
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        user: process.env.EMAIL_USER,
        from: process.env.EMAIL_FROM,
        secure: process.env.EMAIL_PORT == 465
      }
    });
    
  } catch (error) {
    console.error('Error en test de email:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
});

module.exports = router;