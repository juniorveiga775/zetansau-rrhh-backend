const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Configuración de la base de datos (usando valores por defecto)
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'rrhh_portal',
  port: 3306
};

async function runMigration() {
  let connection;
  
  try {
    // Conectar a la base de datos
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Conexión a MySQL establecida');
    
    // Leer el archivo SQL de migración
    const migrationPath = path.join(__dirname, 'add_birth_date_to_users.sql');
    const sqlContent = fs.readFileSync(migrationPath, 'utf8');
    
    // Dividir el contenido en declaraciones individuales
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt && !stmt.startsWith('--'));
    
    // Ejecutar cada declaración
    for (const statement of statements) {
      if (statement) {
        await connection.execute(statement);
        console.log('✅ Ejecutado:', statement.substring(0, 50) + '...');
      }
    }
    
    console.log('🎉 Migración completada exitosamente');
    
  } catch (error) {
    console.error('❌ Error ejecutando migración:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Ejecutar la migración
runMigration();