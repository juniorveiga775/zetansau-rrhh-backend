const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const router = express.Router();

// Validación para configuración de contraseña
const passwordSetupValidation = [
  body('token')
    .notEmpty()
    .withMessage('Token es requerido'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('La contraseña debe tener al menos 6 caracteres')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('La contraseña debe contener al menos una letra minúscula, una mayúscula, un número y un carácter especial'),
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Las contraseñas no coinciden');
      }
      return true;
    })
];

// Verificar token de configuración
router.get('/verify-token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    const query = `
      SELECT id, first_name, last_name, email, setup_token_expiry 
      FROM users 
      WHERE setup_token = ? AND setup_token_expiry > NOW() AND status = 'active'
    `;
    
    const [users] = await db.execute(query, [token]);
    
    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Token inválido o expirado'
      });
    }
    
    const user = users[0];
    
    res.json({
      success: true,
      user: {
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email
      }
    });
    
  } catch (error) {
    console.error('Error verificando token:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// Configurar contraseña
router.post('/setup-password', passwordSetupValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        errors: errors.array()
      });
    }
    
    const { token, password } = req.body;
    
    // Verificar token
    const verifyQuery = `
      SELECT id FROM users 
      WHERE setup_token = ? AND setup_token_expiry > NOW() AND status = 'active'
    `;
    
    const [users] = await db.execute(verifyQuery, [token]);
    
    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Token inválido o expirado'
      });
    }
    
    const userId = users[0].id;
    
    // Hashear nueva contraseña
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Actualizar contraseña y limpiar token
    const updateQuery = `
      UPDATE users 
      SET password = ?, setup_token = NULL, setup_token_expiry = NULL, first_login = 0, updated_at = NOW()
      WHERE id = ?
    `;
    
    await db.execute(updateQuery, [hashedPassword, userId]);
    
    res.json({
      success: true,
      message: 'Contraseña configurada exitosamente'
    });
    
  } catch (error) {
    console.error('Error configurando contraseña:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

module.exports = router;