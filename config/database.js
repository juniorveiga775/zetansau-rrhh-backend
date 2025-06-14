require('dotenv').config();
const { Pool } = require('pg');

// Configuración del pool de conexiones PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10, // máximo número de conexiones
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Función para inicializar la base de datos
const initDatabase = async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Conexión a PostgreSQL establecida correctamente');
    
    // Crear las tablas si no existen
    await createTables(client);
    
    client.release();
  } catch (error) {
    console.error('❌ Error conectando a PostgreSQL:', error.message);
    process.exit(1);
  }
};

// Función para crear las tablas (convertidas a PostgreSQL)
const createTables = async (client) => {
  try {
    // Tabla de usuarios (empleados y administradores)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'employee' CHECK (role IN ('employee', 'admin')),
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
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        first_login BOOLEAN DEFAULT TRUE,
        birth_date DATE,
        setup_token VARCHAR(255),
        setup_token_expires TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de documentos (nóminas y contratos)
    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('payroll', 'contract')),
        title VARCHAR(255) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_size INTEGER,
        month_year VARCHAR(7), -- Para nóminas (formato: YYYY-MM)
        uploaded_by INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (uploaded_by) REFERENCES users(id)
      )
    `);

    // Tabla de solicitudes (permisos, vacaciones, bajas)
    await client.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('permission', 'vacation', 'sick_leave')),
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        days_requested INTEGER NOT NULL,
        reason TEXT,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        admin_comment TEXT,
        reviewed_by INTEGER,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (reviewed_by) REFERENCES users(id)
      )
    `);

    // Tabla de nóminas mensuales
    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll_records (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        month_year VARCHAR(7) NOT NULL, -- Formato: YYYY-MM
        base_salary DECIMAL(10,2) NOT NULL,
        bonuses DECIMAL(10,2) DEFAULT 0,
        deductions DECIMAL(10,2) DEFAULT 0,
        net_salary DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
        payment_date DATE,
        notes TEXT,
        created_by INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id),
        UNIQUE (user_id, month_year)
      )
    `);

    // Tabla de logs de auditoría
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        action VARCHAR(100) NOT NULL,
        table_name VARCHAR(50),
        record_id INTEGER,
        old_values JSONB,
        new_values JSONB,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // Tabla de notificaciones
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(20) DEFAULT 'general' CHECK (type IN ('general', 'urgent', 'info')),
        recipients_type VARCHAR(20) DEFAULT 'all' CHECK (recipients_type IN ('all', 'specific')),
        recipients_count INTEGER DEFAULT 0,
        created_by INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Tabla de lecturas de notificaciones
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_reads (
        id SERIAL PRIMARY KEY,
        notification_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        read_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (notification_id, user_id),
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Tabla de descargas de nóminas
    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll_downloads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        document_id INTEGER NOT NULL,
        downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45),
        user_agent TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      )
    `);

    // Crear usuario administrador por defecto
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash('Jonhy-775', 12);
    
    // Verificar si el administrador ya existe
    const adminCheck = await client.query(
      'SELECT id FROM users WHERE dni = $1 AND role = $2',
      ['ADMIN001', 'admin']
    );
    
    if (adminCheck.rows.length === 0) {
      // Crear nuevo administrador
      await client.query(`
        INSERT INTO users (email, password, role, first_name, last_name, dni, position, department, branch, first_login)
        VALUES ($1, $2, 'admin', 'Administrador', 'Zetansau', 'ADMIN001', 'Administrador RRHH', 'Recursos Humanos', 'Madrid', FALSE)
      `, ['rrhh@zetansau.com', hashedPassword]);
      
      console.log('✅ Usuario administrador creado: rrhh@zetansau.com / Jonhy-775');
    } else {
      // Actualizar administrador existente
      await client.query(`
        UPDATE users SET email = $1, password = $2, first_name = 'Administrador', last_name = 'Zetansau', 
        position = 'Administrador RRHH', department = 'Recursos Humanos', branch = 'Madrid'
        WHERE dni = $3 AND role = 'admin'
      `, ['rrhh@zetansau.com', hashedPassword, 'ADMIN001']);
      
      console.log('✅ Usuario administrador actualizado: rrhh@zetansau.com / Jonhy-775');
    }

    console.log('✅ Tablas de la base de datos creadas/verificadas correctamente');
  } catch (error) {
    console.error('❌ Error creando tablas:', error.message);
    throw error;
  }
};

// Función para ejecutar consultas
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Consulta ejecutada:', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Error en consulta:', error);
    throw error;
  }
};

// Función para obtener un cliente del pool
const getClient = async () => {
  return await pool.connect();
};

module.exports = {
  pool,
  query,
  getClient,
  initDatabase
};