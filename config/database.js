const mysql = require('mysql2/promise');
require('dotenv').config();

// Configuración del pool de conexiones MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'rrhh_portal',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Función para inicializar la base de datos
const initDatabase = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Conexión a MySQL establecida correctamente');
    
    // Crear las tablas si no existen
    await createTables(connection);
    
    connection.release();
  } catch (error) {
    console.error('❌ Error conectando a MySQL:', error.message);
    process.exit(1);
  }
};

// Función para crear las tablas
const createTables = async (connection) => {
  try {
    // Tabla de usuarios (empleados y administradores)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('employee', 'admin') DEFAULT 'employee',
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        dni VARCHAR(20) UNIQUE NOT NULL,
        dni_expiry_date DATE,
        phone VARCHAR(20),
        position VARCHAR(100),
        department VARCHAR(100),
        branch VARCHAR(100),
        salary DECIMAL(10,2),
        hire_date DATE,
        driving_license VARCHAR(50),
        driving_license_expiry_date DATE,
        bank_account VARCHAR(34),
        address TEXT,
        emergency_phone VARCHAR(20),
        status ENUM('active', 'inactive') DEFAULT 'active',
        first_login BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Tabla de documentos (nóminas y contratos)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS documents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        type ENUM('payroll', 'contract') NOT NULL,
        title VARCHAR(255) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_size INT,
        month_year VARCHAR(7), -- Para nóminas (formato: YYYY-MM)
        uploaded_by INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (uploaded_by) REFERENCES users(id)
      )
    `);

    // Tabla de solicitudes (permisos, vacaciones, bajas)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        type ENUM('permission', 'vacation', 'sick_leave') NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        days_requested INT NOT NULL,
        reason TEXT,
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        admin_comment TEXT,
        reviewed_by INT,
        reviewed_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (reviewed_by) REFERENCES users(id)
      )
    `);

    // Tabla de nóminas mensuales
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS payroll_records (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        month_year VARCHAR(7) NOT NULL, -- Formato: YYYY-MM
        base_salary DECIMAL(10,2) NOT NULL,
        bonuses DECIMAL(10,2) DEFAULT 0,
        deductions DECIMAL(10,2) DEFAULT 0,
        net_salary DECIMAL(10,2) NOT NULL,
        status ENUM('pending', 'paid') DEFAULT 'pending',
        payment_date DATE NULL,
        notes TEXT NULL,
        created_by INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id),
        UNIQUE KEY unique_user_month (user_id, month_year)
      )
    `);

    // Migración para agregar columna notes si no existe
    try {
      await connection.execute(`
        ALTER TABLE payroll_records 
        ADD COLUMN notes TEXT NULL
      `);
      console.log('✓ Columna notes agregada a payroll_records');
    } catch (error) {
      if (!error.message.includes('Duplicate column name')) {
        console.log('⚠ Error agregando columna notes:', error.message);
      }
    }

    // Tabla de logs de auditoría
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        action VARCHAR(100) NOT NULL,
        table_name VARCHAR(50),
        record_id INT,
        old_values JSON,
        new_values JSON,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // Migración: Añadir nuevas columnas si no existen
    try {
      // Verificar si las nuevas columnas existen
      const [columns] = await connection.execute(
        "SHOW COLUMNS FROM users LIKE 'dni_expiry_date'"
      );
      
      if (columns.length === 0) {
        console.log('🔄 Ejecutando migración: añadiendo nuevos campos de usuario...');
        
        await connection.execute(`
          ALTER TABLE users 
          ADD COLUMN dni_expiry_date DATE AFTER dni,
          ADD COLUMN driving_license VARCHAR(50) AFTER hire_date,
          ADD COLUMN driving_license_expiry_date DATE AFTER driving_license,
          ADD COLUMN bank_account VARCHAR(34) AFTER driving_license_expiry_date,
          ADD COLUMN address TEXT AFTER bank_account,
          ADD COLUMN emergency_phone VARCHAR(20) AFTER address
        `);
        
        console.log('✅ Migración completada: nuevos campos añadidos a la tabla users');
      }
    } catch (migrationError) {
      console.log('ℹ️ Las columnas ya existen o migración no necesaria');
    }

    // Tabla de notificaciones
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        message TEXT NOT NULL,
        type ENUM('general', 'urgent', 'info') DEFAULT 'general',
        recipients_type ENUM('all', 'specific') DEFAULT 'all',
        recipients_count INT DEFAULT 0,
        created_by INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Tabla de lecturas de notificaciones
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS notification_reads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        notification_id INT NOT NULL,
        user_id INT NOT NULL,
        read_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_notification_user (notification_id, user_id),
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Migración: Añadir campo branch si no existe
    try {
      const [branchColumn] = await connection.execute(
        "SHOW COLUMNS FROM users LIKE 'branch'"
      );
      
      if (branchColumn.length === 0) {
        console.log('🔄 Ejecutando migración: añadiendo campo sucursal...');
        
        await connection.execute(`
          ALTER TABLE users 
          ADD COLUMN branch VARCHAR(100) AFTER department
        `);
        
        console.log('✅ Migración completada: campo sucursal añadido a la tabla users');
      }
    } catch (migrationError) {
      console.log('ℹ️ El campo sucursal ya existe o migración no necesaria');
    }

    // Crear o actualizar usuario administrador por defecto (después de las migraciones)
    const [adminExists] = await connection.execute(
      'SELECT id FROM users WHERE dni = ? AND role = ?',
      ['ADMIN001', 'admin']
    );

    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash('Jonhy-775', 12);

    if (adminExists.length === 0) {
      // Crear nuevo administrador
      await connection.execute(`
        INSERT INTO users (email, password, role, first_name, last_name, dni, position, department, branch, first_login)
        VALUES (?, ?, 'admin', 'Administrador', 'Zetansau', 'ADMIN001', 'Administrador RRHH', 'Recursos Humanos', 'Madrid', FALSE)
      `, ['rrhh@zetansau.com', hashedPassword]);
      
      console.log('✅ Usuario administrador creado: rrhh@zetansau.com / Jonhy-775');
    } else {
      // Actualizar administrador existente
      await connection.execute(`
        UPDATE users SET email = ?, password = ?, first_name = 'Administrador', last_name = 'Zetansau', 
        position = 'Administrador RRHH', department = 'Recursos Humanos', branch = 'Madrid'
        WHERE dni = ? AND role = 'admin'
      `, ['rrhh@zetansau.com', hashedPassword, 'ADMIN001']);
      
      console.log('✅ Usuario administrador actualizado: rrhh@zetansau.com / Jonhy-775');
    }

    console.log('✅ Tablas de la base de datos creadas/verificadas correctamente');
  } catch (error) {
    console.error('❌ Error creando tablas:', error.message);
    throw error;
  }
};

module.exports = {
  pool,
  initDatabase
};