const pool = require('../config/database');
const { sendBirthdayEmail } = require('./emailService');

/**
 * Servicio para gestionar felicitaciones automáticas de cumpleaños
 */
class BirthdayService {
  /**
   * Busca empleados que cumplen años hoy y envía felicitaciones
   */
  static async sendBirthdayGreetings() {
    try {
      console.log('🎂 Iniciando proceso de felicitaciones de cumpleaños...');
      
      // Obtener empleados que cumplen años hoy
      const todaysBirthdays = await this.getTodaysBirthdays();
      
      if (todaysBirthdays.length === 0) {
        console.log('📅 No hay cumpleaños hoy');
        return { success: true, message: 'No hay cumpleaños hoy', count: 0 };
      }
      
      console.log(`🎉 Encontrados ${todaysBirthdays.length} cumpleaños hoy`);
      
      let successCount = 0;
      let errorCount = 0;
      
      // Enviar felicitaciones a cada empleado
      for (const employee of todaysBirthdays) {
        try {
          await sendBirthdayEmail(employee);
          successCount++;
          console.log(`✅ Felicitación enviada a: ${employee.first_name} ${employee.last_name} (${employee.email})`);
        } catch (emailError) {
          errorCount++;
          console.error(`❌ Error enviando felicitación a ${employee.email}:`, emailError.message);
        }
      }
      
      const result = {
        success: true,
        message: `Proceso completado: ${successCount} enviados, ${errorCount} errores`,
        totalBirthdays: todaysBirthdays.length,
        successCount,
        errorCount
      };
      
      console.log('🎂 Proceso de felicitaciones completado:', result.message);
      return result;
      
    } catch (error) {
      console.error('❌ Error en proceso de felicitaciones de cumpleaños:', error);
      return {
        success: false,
        message: 'Error en proceso de felicitaciones',
        error: error.message
      };
    }
  }
  
  /**
   * Obtiene empleados que cumplen años hoy
   */
  static async getTodaysBirthdays() {
    try {
      const [employees] = await pool.execute(`
        SELECT 
          id, email, first_name, last_name, birth_date, position, department
        FROM users 
        WHERE 
          status = 'active' 
          AND birth_date IS NOT NULL
          AND MONTH(birth_date) = MONTH(CURDATE())
          AND DAY(birth_date) = DAY(CURDATE())
        ORDER BY first_name, last_name
      `);
      
      return employees;
    } catch (error) {
      console.error('Error obteniendo cumpleaños de hoy:', error);
      throw error;
    }
  }
  
  /**
   * Obtiene próximos cumpleaños (siguientes 30 días)
   */
  static async getUpcomingBirthdays(days = 30) {
    try {
      const [employees] = await pool.execute(`
        SELECT 
          id, email, first_name, last_name, birth_date, position, department,
          CASE 
            WHEN DAYOFYEAR(DATE(CONCAT(YEAR(CURDATE()), '-', MONTH(birth_date), '-', DAY(birth_date)))) >= DAYOFYEAR(CURDATE())
            THEN DAYOFYEAR(DATE(CONCAT(YEAR(CURDATE()), '-', MONTH(birth_date), '-', DAY(birth_date)))) - DAYOFYEAR(CURDATE())
            ELSE DAYOFYEAR(DATE(CONCAT(YEAR(CURDATE()) + 1, '-', MONTH(birth_date), '-', DAY(birth_date)))) - DAYOFYEAR(CURDATE())
          END as days_until_birthday
        FROM users 
        WHERE 
          status = 'active' 
          AND birth_date IS NOT NULL
        HAVING days_until_birthday <= ?
        ORDER BY days_until_birthday, first_name, last_name
      `, [days]);
      
      return employees;
    } catch (error) {
      console.error('Error obteniendo próximos cumpleaños:', error);
      throw error;
    }
  }
  
  /**
   * Programa la ejecución automática diaria
   */
  static scheduleDailyBirthdayCheck() {
    const cron = require('node-cron');
    
    // Ejecutar todos los días a las 9:00 AM
    cron.schedule('0 9 * * *', async () => {
      console.log('⏰ Ejecutando verificación automática de cumpleaños...');
      await this.sendBirthdayGreetings();
    }, {
      timezone: 'America/Mexico_City'
    });
    
    console.log('📅 Programación de cumpleaños activada: todos los días a las 9:00 AM');
  }
}

module.exports = BirthdayService;