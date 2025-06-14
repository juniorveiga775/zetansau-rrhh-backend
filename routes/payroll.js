const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Obtener todos los registros de nómina (solo admin)
router.get('/', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Acceso denegado' });
    }

    const { month_year, status, user_id } = req.query;
    let query = `
      SELECT 
        pr.*,
        u.first_name,
        u.last_name,
        u.branch,
        u.bank_account,
        u.position
      FROM payroll_records pr
      JOIN users u ON pr.user_id = u.id
      WHERE u.status = 'active'
    `;
    const params = [];

    if (month_year) {
      query += ' AND pr.month_year = ?';
      params.push(month_year);
    }

    if (status) {
      query += ' AND pr.status = ?';
      params.push(status);
    }

    if (user_id) {
      query += ' AND pr.user_id = ?';
      params.push(user_id);
    }

    query += ' ORDER BY pr.month_year DESC, u.last_name, u.first_name';

    const [records] = await pool.execute(query, params);
    res.json({ success: true, data: records });
  } catch (error) {
    console.error('Error obteniendo registros de nómina:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Obtener trabajadores activos para un mes específico
router.get('/workers/:monthYear', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Acceso denegado' });
    }

    const { monthYear } = req.params;

    // Validar formato del mes
    if (!/^\d{4}-\d{2}$/.test(monthYear)) {
      return res.status(400).json({ message: 'Formato de mes inválido. Use YYYY-MM' });
    }

    // Obtener trabajadores con sus registros de nómina (solo si existen)
    const query = `
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.branch,
        u.salary,
        u.bank_account,
        u.position,
        pr.id as payroll_id,
        pr.base_salary,
        pr.bonuses,
        pr.deductions,
        pr.net_salary,
        pr.status,
        pr.payment_date,
        pr.notes
      FROM users u
      INNER JOIN payroll_records pr ON u.id = pr.user_id AND pr.month_year = ?
      WHERE u.status = 'active' AND u.role = 'employee'
      ORDER BY u.last_name, u.first_name
    `;

    const [workers] = await pool.execute(query, [monthYear]);
    res.json({ success: true, data: workers });
  } catch (error) {
    console.error('Error obteniendo trabajadores:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Crear o actualizar registro de nómina
router.post('/', [
  authenticateToken,
  body('user_id').isInt().withMessage('ID de usuario requerido'),
  body('month_year').matches(/^\d{4}-\d{2}$/).withMessage('Formato de mes inválido (YYYY-MM)'),
  body('base_salary').isDecimal().withMessage('Salario base debe ser numérico'),
  body('bonuses').optional().isDecimal().withMessage('Bonificaciones deben ser numéricas'),
  body('deductions').optional().isDecimal().withMessage('Deducciones deben ser numéricas'),
  body('status').isIn(['pending', 'paid']).withMessage('Estado inválido'),
  body('notes').optional().isString().withMessage('Notas deben ser texto')
], async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Acceso denegado' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Datos inválidos', errors: errors.array() });
    }

    const { user_id, month_year, base_salary, bonuses = 0, deductions = 0, status, payment_date, notes } = req.body;
    const net_salary = parseFloat(base_salary) + parseFloat(bonuses) - parseFloat(deductions);

    // Verificar si ya existe un registro para este usuario y mes
    const [existing] = await pool.execute(
      'SELECT id FROM payroll_records WHERE user_id = ? AND month_year = ?',
      [user_id, month_year]
    );

    if (existing.length > 0) {
      // Actualizar registro existente
      await pool.execute(`
        UPDATE payroll_records 
        SET base_salary = ?, bonuses = ?, deductions = ?, net_salary = ?, 
            status = ?, payment_date = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND month_year = ?
      `, [base_salary, bonuses, deductions, net_salary, status, payment_date, notes, user_id, month_year]);
    } else {
      // Crear nuevo registro
      await pool.execute(`
        INSERT INTO payroll_records 
        (user_id, month_year, base_salary, bonuses, deductions, net_salary, status, payment_date, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [user_id, month_year, base_salary, bonuses, deductions, net_salary, status, payment_date, notes, req.user.id]);
    }

    res.json({ success: true, message: 'Registro de nómina guardado correctamente' });
  } catch (error) {
    console.error('Error guardando registro de nómina:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Actualizar estado de pago
router.patch('/:id/status', [
  authenticateToken,
  body('status').isIn(['pending', 'paid']).withMessage('Estado inválido'),
  body('payment_date').optional().isISO8601().withMessage('Fecha de pago inválida'),
  body('notes').optional().isString().withMessage('Notas deben ser texto')
], async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Acceso denegado' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Datos inválidos', errors: errors.array() });
    }

    const { id } = req.params;
    const { status, payment_date, notes } = req.body;

    await pool.execute(`
      UPDATE payroll_records 
      SET status = ?, payment_date = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, payment_date, notes, id]);

    res.json({ success: true, message: 'Estado actualizado correctamente' });
  } catch (error) {
    console.error('Error actualizando estado:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Eliminar registro de nómina
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Acceso denegado' });
    }

    const { id } = req.params;

    const [result] = await pool.execute(
      'DELETE FROM payroll_records WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Registro no encontrado' });
    }

    res.json({ success: true, message: 'Registro eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando registro:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Generar nómina para un mes específico
router.post('/generate/:monthYear', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Acceso denegado' });
    }

    const { monthYear } = req.params;

    // Validar formato del mes
    if (!/^\d{4}-\d{2}$/.test(monthYear)) {
      return res.status(400).json({ message: 'Formato de mes inválido. Use YYYY-MM' });
    }

    // Verificar que sea el mes corriente
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    
    if (monthYear !== currentMonth) {
      return res.status(400).json({ message: 'Solo se puede generar la nómina para el mes corriente' });
    }

    // Crear registros de nómina para trabajadores activos que no tengan registro para este mes
    const createRecordsQuery = `
      INSERT INTO payroll_records (user_id, month_year, base_salary, bonuses, deductions, net_salary, status, created_by)
      SELECT 
        u.id,
        ? as month_year,
        u.salary as base_salary,
        0 as bonuses,
        0 as deductions,
        u.salary as net_salary,
        'pending' as status,
        ? as created_by
      FROM users u
      WHERE u.status = 'active' 
        AND u.role = 'employee'
        AND NOT EXISTS (
          SELECT 1 FROM payroll_records pr 
          WHERE pr.user_id = u.id AND pr.month_year = ?
        )
    `;

    const [result] = await pool.execute(createRecordsQuery, [monthYear, req.user.id, monthYear]);

    res.json({ 
      success: true, 
      message: `Nómina generada correctamente. ${result.affectedRows} registros creados para ${monthYear}`,
      createdCount: result.affectedRows
    });
  } catch (error) {
    console.error('Error generando nómina:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Eliminar todos los registros de un mes específico
router.delete('/month/:monthYear', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Acceso denegado' });
    }

    const { monthYear } = req.params;

    // Validar formato del mes
    if (!/^\d{4}-\d{2}$/.test(monthYear)) {
      return res.status(400).json({ message: 'Formato de mes inválido. Use YYYY-MM' });
    }

    const [result] = await pool.execute(
      'DELETE FROM payroll_records WHERE month_year = ?',
      [monthYear]
    );

    res.json({ 
      success: true, 
      message: `${result.affectedRows} registros eliminados para ${monthYear}`,
      deletedCount: result.affectedRows
    });
  } catch (error) {
    console.error('Error eliminando registros del mes:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// GET /api/payroll/downloads - Obtener registros de descarga de nóminas (solo admin)
router.get('/downloads', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Acceso denegado' });
    }

    const { month_year, user_id, download_type } = req.query;
    let query = `
      SELECT 
        pd.*,
        u.first_name,
        u.last_name,
        u.email,
        pr.month_year,
        pr.net_salary,
        d.title as document_title
      FROM payroll_downloads pd
      JOIN users u ON pd.user_id = u.id
      JOIN payroll_records pr ON pd.payroll_record_id = pr.id
      LEFT JOIN documents d ON pd.document_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (month_year) {
      query += ' AND pr.month_year = ?';
      params.push(month_year);
    }

    if (user_id) {
      query += ' AND pd.user_id = ?';
      params.push(user_id);
    }

    if (download_type) {
      query += ' AND pd.download_type = ?';
      params.push(download_type);
    }

    query += ' ORDER BY pd.downloaded_at DESC';

    const [downloads] = await pool.execute(query, params);
    res.json({ success: true, data: downloads });
  } catch (error) {
    console.error('Error obteniendo registros de descarga:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// GET /api/payroll/downloads/stats - Obtener estadísticas de descarga de nóminas (solo admin)
router.get('/downloads/stats', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Acceso denegado' });
    }

    const { month_year } = req.query;
    let whereClause = '';
    const params = [];

    if (month_year) {
      whereClause = 'WHERE pr.month_year = ?';
      params.push(month_year);
    }

    // Estadísticas generales
    const [stats] = await pool.execute(`
      SELECT 
        COUNT(DISTINCT pd.user_id) as users_downloaded,
        COUNT(CASE WHEN pd.download_type = 'download' THEN 1 END) as total_downloads,
        COUNT(CASE WHEN pd.download_type = 'view' THEN 1 END) as total_views,
        COUNT(*) as total_accesses
      FROM payroll_downloads pd
      JOIN payroll_records pr ON pd.payroll_record_id = pr.id
      ${whereClause}
    `, params);

    // Usuarios que no han descargado
    const [notDownloaded] = await pool.execute(`
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        pr.month_year,
        pr.net_salary
      FROM users u
      JOIN payroll_records pr ON u.id = pr.user_id
      LEFT JOIN payroll_downloads pd ON pr.id = pd.payroll_record_id
      WHERE u.role = 'employee' 
        AND u.status = 'active'
        AND pd.id IS NULL
        ${month_year ? 'AND pr.month_year = ?' : ''}
      ORDER BY u.last_name, u.first_name
    `, month_year ? [month_year] : []);

    res.json({ 
      success: true, 
      data: {
        stats: stats[0],
        not_downloaded: notDownloaded
      }
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas de descarga:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

module.exports = router;