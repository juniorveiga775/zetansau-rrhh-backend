const NodeCache = require('node-cache');

// Cache para tipos de notificaciones (TTL: 1 hora)
const notificationTypesCache = new NodeCache({ stdTTL: 3600 });

// Cache para estadísticas (TTL: 15 minutos)
const statsCache = new NodeCache({ stdTTL: 900 });

// Cache para conteo de notificaciones no leídas (TTL: 5 minutos)
const unreadCountCache = new NodeCache({ stdTTL: 300 });

module.exports = {
  notificationTypesCache,
  statsCache,
  unreadCountCache,
  
  // Función para limpiar cache relacionado con notificaciones
  clearNotificationCaches: () => {
    statsCache.flushAll();
    unreadCountCache.flushAll();
    console.log('Cache de notificaciones limpiado');
  },
  
  // Función para generar clave de cache
  generateCacheKey: (prefix, ...params) => {
    return `${prefix}:${params.join(':')}`;
  }
};