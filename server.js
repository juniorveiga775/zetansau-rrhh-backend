const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Importar configuración de base de datos
const { initDatabase } = require('./config/database');

// Importar middleware
const { apiLimiter } = require('./middleware/security');
const { securityConfig, ipValidation, securityLogger, headerValidation } = require('./config/security');

// Importar rutas
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const documentRoutes = require('./routes/documents');
const requestRoutes = require('./routes/requests');
const payrollRoutes = require('./routes/payroll');
const notificationRoutes = require('./routes/notifications');
const passwordSetupRoutes = require('./routes/password-setup');
const birthdayRoutes = require('./routes/birthdays');

// Importar servicio WebSocket
const webSocketService = require('./services/websocketService');

// Importar servicio de cumpleaños
const BirthdayService = require('./services/birthdayService');

// Crear aplicación Express
const app = express();
const PORT = process.env.PORT || 5000;

// Crear servidor HTTP
const server = http.createServer(app);

// Trust proxy para obtener IP real detrás de proxy/load balancer
app.set('trust proxy', 1);

// Middleware de logging de seguridad
app.use(securityLogger);

// Middleware de validación de IP (solo en producción)
if (process.env.NODE_ENV === 'production') {
  app.use(ipValidation);
}

// Middleware de seguridad con Helmet
app.use(helmet(securityConfig.helmet));

// Configuración de CORS
app.use(cors(securityConfig.cors));

// Validación de headers
app.use(headerValidation);

// Rate limiting general
app.use('/api/', securityConfig.rateLimiting.api);

// Middleware para parsing de JSON con límites de seguridad
app.use(express.json({ 
  limit: process.env.NODE_ENV === 'production' ? '5mb' : '10mb',
  verify: (req, res, buf) => {
    // Validar que el JSON no esté malformado
    try {
      JSON.parse(buf);
    } catch (e) {
      res.status(400).json({
        success: false,
        message: 'JSON malformado',
        code: 'INVALID_JSON'
      });
      return;
    }
  }
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: process.env.NODE_ENV === 'production' ? '5mb' : '10mb'
}));

// Aplicar rate limiting específico a las rutas de autenticación
app.use('/api/auth/login', securityConfig.rateLimiting.login);
app.use('/api/auth', apiLimiter);

// Rate limiting para operaciones sensibles
app.use('/api/users', securityConfig.rateLimiting.sensitive);
app.use('/api/payroll', securityConfig.rateLimiting.sensitive);

// Servir archivos estáticos (documentos subidos)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Middleware para logging de requests en desarrollo
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/password-setup', passwordSetupRoutes);
app.use('/api/birthdays', birthdayRoutes);

// Ruta de health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Portal RRHH API funcionando correctamente',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Ruta raíz
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Portal de RRHH - API Backend',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      documents: '/api/documents',
      requests: '/api/requests',
      health: '/api/health'
    }
  });
});

// Middleware para rutas no encontradas
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint no encontrado',
    path: req.originalUrl
  });
});

// Middleware global de manejo de errores
app.use((error, req, res, next) => {
  console.error('Error no manejado:', error);
  
  // Error de Multer (subida de archivos)
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: 'El archivo es demasiado grande'
    });
  }
  
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      message: 'Campo de archivo inesperado'
    });
  }
  
  // Error de validación de archivos
  if (error.message.includes('Solo se permiten archivos PDF')) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
  
  // Error genérico
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'Error interno del servidor'
      : error.message
  });
});

// Función para iniciar el servidor
const startServer = async () => {
  try {
    // Inicializar base de datos
    await initDatabase();
    
    // Crear directorio de uploads si no existe
    const fs = require('fs');
    const uploadPath = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
      console.log('✅ Directorio de uploads creado');
    }
    
    // Inicializar WebSocket
    webSocketService.initialize(server);
    
    // Inicializar servicio de cumpleaños
    BirthdayService.scheduleDailyBirthdayCheck();
    console.log('🎂 Servicio de felicitaciones de cumpleaños activado');
    
    // Iniciar servidor
    server.listen(PORT, () => {
      console.log('🚀 ========================================');
      console.log(`🚀 Portal RRHH API iniciado correctamente`);
      console.log(`🚀 Puerto: ${PORT}`);
      console.log(`🚀 Entorno: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🚀 URL: http://localhost:${PORT}`);
      console.log('🔌 WebSocket habilitado para notificaciones en tiempo real');
      console.log('🚀 ========================================');
      console.log('📋 Endpoints disponibles:');
      console.log('   • POST /api/auth/login - Iniciar sesión');
      console.log('   • POST /api/auth/change-password - Cambiar contraseña');
      console.log('   • GET  /api/auth/me - Perfil del usuario');
      console.log('   • GET  /api/users - Lista de usuarios (admin)');
      console.log('   • POST /api/users - Crear usuario (admin)');
      console.log('   • GET  /api/documents - Documentos del usuario');
      console.log('   • POST /api/documents/upload - Subir documento (admin)');
      console.log('   • GET  /api/requests - Solicitudes');
      console.log('   • POST /api/requests - Crear solicitud');
      console.log('   • GET  /api/notifications - Notificaciones (con filtros)');
      console.log('   • POST /api/notifications - Crear notificación (admin)');
      console.log('   • GET  /api/health - Estado del servidor');
      console.log('🚀 ========================================');
      
      if (process.env.NODE_ENV !== 'production') {
        console.log('🔐 Credenciales de administrador por defecto:');
        console.log('   Email: rrhh@zetansau.com');
        console.log('   Contraseña: Jonhy-775');
        console.log('🚀 ========================================');
      }
    });
    
  } catch (error) {
    console.error('❌ Error iniciando el servidor:', error);
    process.exit(1);
  }
};

// Manejo de señales para cierre graceful
process.on('SIGTERM', () => {
  console.log('\n🛑 Recibida señal SIGTERM, cerrando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Recibida señal SIGINT, cerrando servidor...');
  process.exit(0);
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada:', reason);
  process.exit(1);
});

// Iniciar servidor
startServer();

module.exports = app;