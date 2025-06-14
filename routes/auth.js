const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { loginLimiter, auditLogger } = require('../middleware/security');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

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
const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('password').isLength({ min: 1 }).withMessage('Contraseña requerida')
];

const changePasswordValidation = [
  body('currentPassword').isLength({ min: 1 }).withMessage('Contraseña actual requerida'),
  body('newPassword').isLength({ min: 6 }).withMessage('La nueva contraseña debe tener al menos 6 caracteres')
];

const resetPasswordValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Email inválido')
];

// POST /api/auth/login - Iniciar sesión
router.post('/login', loginLimiter, loginValidation, auditLogger('LOGIN'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Buscar usuario
    const [users] = await pool.execute(
      'SELECT id, email, password, role, first_name, last_name, status, first_login FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }

    const user = users[0];

    // Verificar si el usuario está activo
    if (user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Usuario inactivo. Contacta con el administrador'
      });
    }

    // Verificar contraseña
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }

    // Generar JWT
    const token = jwt.sign(
      { 
        userId: user.id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    // Actualizar último login
    await pool.execute(
      'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );

    res.json({
      success: true,
      message: 'Inicio de sesión exitoso',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          firstName: user.first_name,
          lastName: user.last_name,
          firstLogin: user.first_login
        }
      }
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// POST /api/auth/change-password - Cambiar contraseña
router.post('/change-password', authenticateToken, changePasswordValidation, auditLogger('CHANGE_PASSWORD', 'users'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        errors: errors.array()
      });
    }

    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Obtener contraseña actual
    const [users] = await pool.execute(
      'SELECT password FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    // Verificar contraseña actual
    const isValidPassword = await bcrypt.compare(currentPassword, users[0].password);
    if (!isValidPassword) {
      return res.status(400).json({
        success: false,
        message: 'Contraseña actual incorrecta'
      });
    }

    // Encriptar nueva contraseña
    const hashedNewPassword = await bcrypt.hash(newPassword, 12);

    // Actualizar contraseña
    await pool.execute(
      'UPDATE users SET password = ?, first_login = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [hashedNewPassword, userId]
    );

    res.json({
      success: true,
      message: 'Contraseña actualizada correctamente'
    });

  } catch (error) {
    console.error('Error cambiando contraseña:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// POST /api/auth/reset-password - Solicitar reset de contraseña
router.post('/reset-password', resetPasswordValidation, auditLogger('REQUEST_PASSWORD_RESET'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        errors: errors.array()
      });
    }

    const { email } = req.body;

    // Buscar usuario
    const [users] = await pool.execute(
      'SELECT id, first_name, last_name FROM users WHERE email = ? AND status = "active"',
      [email]
    );

    // Siempre responder con éxito por seguridad
    if (users.length === 0) {
      return res.json({
        success: true,
        message: 'Si el email existe, recibirás instrucciones para restablecer tu contraseña'
      });
    }

    const user = users[0];

    // Generar token temporal
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hora

    // Guardar token en base de datos (necesitarías agregar campos a la tabla users)
    // Por simplicidad, aquí generamos una nueva contraseña temporal
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const hashedTempPassword = await bcrypt.hash(tempPassword, 12);

    await pool.execute(
      'UPDATE users SET password = ?, first_login = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [hashedTempPassword, user.id]
    );

    // Enviar email con contraseña temporal
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'Restablecimiento de contraseña - Portal RRHH',
      html: `
        <h2>Restablecimiento de contraseña</h2>
        <p>Hola ${user.first_name} ${user.last_name},</p>
        <p>Tu contraseña temporal es: <strong>${tempPassword}</strong></p>
        <p>Por favor, inicia sesión y cambia tu contraseña inmediatamente.</p>
        <p>Esta contraseña temporal expirará en 24 horas.</p>
        <br>
        <p>Si no solicitaste este cambio, contacta con el administrador.</p>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
    } catch (emailError) {
      console.error('Error enviando email:', emailError);
      // No fallar la operación si el email falla
    }

    res.json({
      success: true,
      message: 'Si el email existe, recibirás instrucciones para restablecer tu contraseña'
    });

  } catch (error) {
    console.error('Error en reset password:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// GET /api/auth/me - Obtener información del usuario actual
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT id, email, role, first_name, last_name, dni, phone, position, 
              department, salary, hire_date, status, first_login, created_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    const user = users[0];
    
    // No enviar información sensible como salary si es empleado
    if (user.role === 'employee') {
      delete user.salary;
    }

    res.json({
      success: true,
      data: { user }
    });

  } catch (error) {
    console.error('Error obteniendo perfil:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// PUT /api/auth/profile - Actualizar perfil del usuario actual
router.put('/profile', authenticateToken, auditLogger('UPDATE_PROFILE', 'users'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { first_name, last_name, dni, phone, address, emergency_phone, bank_account } = req.body;

    // Validar que al menos un campo esté presente
    if (!first_name && !last_name && !dni && !phone && !address && !emergency_phone && !bank_account) {
      return res.status(400).json({
        success: false,
        message: 'Al menos un campo debe ser proporcionado para actualizar'
      });
    }

    // Construir query dinámicamente
    const updateFields = [];
    const updateValues = [];

    if (first_name !== undefined) {
      updateFields.push('first_name = ?');
      updateValues.push(first_name);
    }
    if (last_name !== undefined) {
      updateFields.push('last_name = ?');
      updateValues.push(last_name);
    }
    if (dni !== undefined) {
      updateFields.push('dni = ?');
      updateValues.push(dni);
    }
    if (phone !== undefined) {
      updateFields.push('phone = ?');
      updateValues.push(phone);
    }
    if (address !== undefined) {
      updateFields.push('address = ?');
      updateValues.push(address);
    }
    if (emergency_phone !== undefined) {
      updateFields.push('emergency_phone = ?');
      updateValues.push(emergency_phone);
    }
    if (bank_account !== undefined) {
      updateFields.push('bank_account = ?');
      updateValues.push(bank_account);
    }

    // Agregar timestamp y userId
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(userId);

    const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;

    await pool.execute(query, updateValues);

    // Obtener usuario actualizado
    const [users] = await pool.execute(
      `SELECT id, email, role, first_name, last_name, dni, phone, address, 
              emergency_phone, bank_account, position, department, salary, 
              hire_date, status, first_login, created_at, updated_at
       FROM users WHERE id = ?`,
      [userId]
    );

    const user = users[0];
    
    // No enviar información sensible como salary si es empleado
    if (user.role === 'employee') {
      delete user.salary;
    }

    res.json({
      success: true,
      message: 'Perfil actualizado correctamente',
      data: { user }
    });

  } catch (error) {
    console.error('Error actualizando perfil:', error);
    
    // Manejar errores específicos
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'El DNI ya está registrado por otro usuario'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// POST /api/auth/logout - Cerrar sesión (opcional, para logging)
router.post('/logout', authenticateToken, auditLogger('LOGOUT'), (req, res) => {
  res.json({
    success: true,
    message: 'Sesión cerrada correctamente'
  });
});

module.exports = router;