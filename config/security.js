const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');

// Configuración de seguridad para producción
const securityConfig = {
  // Configuración de Helmet para headers de seguridad
  helmet: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", "https://zetansau.com"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    noSniff: true,
    frameguard: { action: 'deny' },
    xssFilter: true
  },

  // Configuración de CORS
  cors: {
    origin: function (origin, callback) {
      const allowedOrigins = process.env.NODE_ENV === 'production'
        ? ['https://zetansau.com', 'https://www.zetansau.com']
        : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000'];
      
      // Permitir requests sin origin (como aplicaciones móviles)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('No permitido por CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Total-Count'],
    maxAge: 86400 // 24 horas
  },

  // Rate limiting más estricto para producción
  rateLimiting: {
    // Rate limiting para login
    login: rateLimit({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 3,
      message: {
        success: false,
        message: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos.',
        code: 'TOO_MANY_LOGIN_ATTEMPTS'
      },
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => {
        return req.ip + ':' + (req.body.email || 'unknown');
      }
    }),

    // Rate limiting general para API
    api: rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutos
      max: process.env.NODE_ENV === 'production' ? 100 : 1000,
      message: {
        success: false,
        message: 'Demasiadas solicitudes. Intenta de nuevo más tarde.',
        code: 'TOO_MANY_REQUESTS'
      },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => {
        // Skip rate limiting para health checks
        return req.path === '/health' || req.path === '/api/health';
      }
    }),

    // Rate limiting estricto para operaciones sensibles
    sensitive: rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hora
      max: 5,
      message: {
        success: false,
        message: 'Demasiadas operaciones sensibles. Intenta de nuevo en 1 hora.',
        code: 'TOO_MANY_SENSITIVE_OPERATIONS'
      },
      standardHeaders: true,
      legacyHeaders: false
    })
  }
};

// Middleware de validación de IP
const ipWhitelist = process.env.IP_WHITELIST ? process.env.IP_WHITELIST.split(',') : [];

const ipValidation = (req, res, next) => {
  if (process.env.NODE_ENV === 'production' && ipWhitelist.length > 0) {
    const clientIP = req.ip || req.connection.remoteAddress;
    
    if (!ipWhitelist.includes(clientIP)) {
      console.warn(`Acceso denegado desde IP no autorizada: ${clientIP}`);
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado',
        code: 'IP_NOT_ALLOWED'
      });
    }
  }
  next();
};

// Middleware de logging de seguridad
const securityLogger = (req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      statusCode: res.statusCode,
      duration: duration,
      userId: req.user?.id || null
    };

    // Log de eventos de seguridad importantes
    if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 429) {
      console.warn('Security Event:', JSON.stringify(logData));
    }

    // Log de requests lentos (posible ataque DoS)
    if (duration > 5000) {
      console.warn('Slow Request:', JSON.stringify(logData));
    }
  });

  next();
};

// Middleware de validación de headers
const headerValidation = (req, res, next) => {
  // Validar Content-Type para requests POST/PUT
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.get('Content-Type');
    if (!contentType || (!contentType.includes('application/json') && !contentType.includes('multipart/form-data'))) {
      return res.status(400).json({
        success: false,
        message: 'Content-Type inválido',
        code: 'INVALID_CONTENT_TYPE'
      });
    }
  }

  // Validar tamaño de headers
  const headerSize = JSON.stringify(req.headers).length;
  if (headerSize > 8192) { // 8KB máximo
    return res.status(400).json({
      success: false,
      message: 'Headers demasiado grandes',
      code: 'HEADERS_TOO_LARGE'
    });
  }

  next();
};

module.exports = {
  securityConfig,
  ipValidation,
  securityLogger,
  headerValidation
};