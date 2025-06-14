const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const BirthdayService = require('../services/birthdayService');

/**
 * @route GET /api/birthdays/today
 * @desc Obtener empleados que cumplen años hoy
 * @access Admin
 */
router.get('/today', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const todaysBirthdays = await BirthdayService.getTodaysBirthdays();
    
    res.json({
      success: true,
      message: `Encontrados ${todaysBirthdays.length} cumpleaños hoy`,
      data: {
        birthdays: todaysBirthdays,
        count: todaysBirthdays.length
      }
    });
  } catch (error) {
    console.error('Error obteniendo cumpleaños de hoy:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo cumpleaños de hoy',
      error: error.message
    });
  }
});

/**
 * @route GET /api/birthdays/upcoming
 * @desc Obtener próximos cumpleaños
 * @access Admin
 */
router.get('/upcoming', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    
    if (days < 1 || days > 365) {
      return res.status(400).json({
        success: false,
        message: 'El número de días debe estar entre 1 y 365'
      });
    }
    
    const upcomingBirthdays = await BirthdayService.getUpcomingBirthdays(days);
    
    res.json({
      success: true,
      message: `Próximos cumpleaños en ${days} días`,
      data: {
        birthdays: upcomingBirthdays,
        count: upcomingBirthdays.length,
        days: days
      }
    });
  } catch (error) {
    console.error('Error obteniendo próximos cumpleaños:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo próximos cumpleaños',
      error: error.message
    });
  }
});

/**
 * @route POST /api/birthdays/send-greetings
 * @desc Enviar felicitaciones de cumpleaños manualmente
 * @access Admin
 */
router.post('/send-greetings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log(`🎂 Felicitaciones de cumpleaños iniciadas manualmente por: ${req.user.email}`);
    
    const result = await BirthdayService.sendBirthdayGreetings();
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        data: {
          totalBirthdays: result.totalBirthdays || 0,
          successCount: result.successCount || 0,
          errorCount: result.errorCount || 0
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error enviando felicitaciones manuales:', error);
    res.status(500).json({
      success: false,
      message: 'Error enviando felicitaciones de cumpleaños',
      error: error.message
    });
  }
});

/**
 * @route GET /api/birthdays/stats
 * @desc Obtener estadísticas de cumpleaños
 * @access Admin
 */
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [todaysBirthdays, upcomingBirthdays] = await Promise.all([
      BirthdayService.getTodaysBirthdays(),
      BirthdayService.getUpcomingBirthdays(7) // Próximos 7 días
    ]);
    
    // Agrupar próximos cumpleaños por mes
    const monthlyStats = {};
    const upcoming30Days = await BirthdayService.getUpcomingBirthdays(30);
    
    upcoming30Days.forEach(employee => {
      const month = new Date(employee.birth_date).getMonth();
      const monthName = new Date(2024, month).toLocaleDateString('es-ES', { month: 'long' });
      
      if (!monthlyStats[monthName]) {
        monthlyStats[monthName] = 0;
      }
      monthlyStats[monthName]++;
    });
    
    res.json({
      success: true,
      message: 'Estadísticas de cumpleaños obtenidas',
      data: {
        today: {
          count: todaysBirthdays.length,
          employees: todaysBirthdays
        },
        thisWeek: {
          count: upcomingBirthdays.length,
          employees: upcomingBirthdays
        },
        next30Days: {
          count: upcoming30Days.length,
          monthlyBreakdown: monthlyStats
        }
      }
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas de cumpleaños:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo estadísticas de cumpleaños',
      error: error.message
    });
  }
});

module.exports = router;