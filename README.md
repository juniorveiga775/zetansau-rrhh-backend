# Portal RRHH - Backend API

## Descripción

API REST para el Portal de Recursos Humanos desarrollada con Node.js, Express y MySQL. Proporciona funcionalidades completas para la gestión de empleados, documentos y solicitudes.

## Características

- 🔐 **Autenticación JWT** con roles diferenciados (empleado/administrador)
- 👥 **Gestión de usuarios** completa (CRUD)
- 📄 **Gestión de documentos** (nóminas y contratos en PDF)
- 📝 **Sistema de solicitudes** (permisos, vacaciones, bajas)
- 🔒 **Seguridad avanzada** (rate limiting, validaciones, auditoría)
- 📧 **Notificaciones por email**
- 📊 **Dashboard con estadísticas**
- 🗃️ **Logs de auditoría**

## Requisitos

- Node.js 16+ 
- MySQL 8.0+
- npm o yarn

## Instalación

1. **Instalar dependencias:**
```bash
npm install
```

2. **Configurar variables de entorno:**
```bash
cp .env.example .env
```

Editar el archivo `.env` con tus configuraciones:

```env
# Servidor
PORT=5000
NODE_ENV=development

# Base de datos MySQL
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=tu_password
DB_NAME=rrhh_portal
DB_PORT=3306

# JWT
JWT_SECRET=tu_jwt_secret_muy_seguro
JWT_EXPIRES_IN=24h

# Email (opcional)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=tu_email@gmail.com
EMAIL_PASS=tu_password_de_aplicacion
EMAIL_FROM=noreply@rrhh-portal.com
```

3. **Crear base de datos:**
```sql
CREATE DATABASE rrhh_portal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

4. **Iniciar servidor:**
```bash
# Desarrollo
npm run dev

# Producción
npm start
```

La API estará disponible en `http://localhost:5000`

## Estructura del Proyecto

```
backend/
├── config/
│   └── database.js          # Configuración MySQL
├── middleware/
│   ├── auth.js              # Autenticación JWT
│   └── security.js          # Rate limiting y auditoría
├── routes/
│   ├── auth.js              # Rutas de autenticación
│   ├── users.js             # Gestión de usuarios
│   ├── documents.js         # Gestión de documentos
│   └── requests.js          # Gestión de solicitudes
├── uploads/                 # Archivos subidos
├── .env.example             # Variables de entorno
├── package.json
├── server.js                # Servidor principal
└── README.md
```

## Endpoints Principales

### Autenticación
- `POST /api/auth/login` - Iniciar sesión
- `POST /api/auth/change-password` - Cambiar contraseña
- `POST /api/auth/reset-password` - Resetear contraseña
- `GET /api/auth/me` - Perfil del usuario

### Usuarios (Admin)
- `GET /api/users` - Lista de empleados
- `POST /api/users` - Crear empleado
- `PUT /api/users/:id` - Actualizar empleado
- `DELETE /api/users/:id` - Eliminar empleado
- `POST /api/users/:id/reset-password` - Resetear contraseña

### Documentos
- `GET /api/documents` - Lista de documentos
- `GET /api/documents/:id/download` - Descargar documento
- `POST /api/documents/upload` - Subir documento (Admin)
- `DELETE /api/documents/:id` - Eliminar documento (Admin)

### Solicitudes
- `GET /api/requests` - Lista de solicitudes
- `POST /api/requests` - Crear solicitud
- `PUT /api/requests/:id/review` - Revisar solicitud (Admin)
- `DELETE /api/requests/:id` - Eliminar solicitud

## Credenciales por Defecto

**Administrador:**
- Email: `rrhh@zetansau.com`
- Contraseña: `Jonhy-775`

## Roles y Permisos

### Empleado (`employee`)
- Ver y actualizar su perfil
- Descargar sus documentos (nóminas/contratos)
- Crear y gestionar sus solicitudes
- Cambiar su contraseña

### Administrador (`admin`)
- Todas las funciones de empleado
- Gestionar todos los usuarios
- Subir y gestionar documentos
- Revisar y aprobar/rechazar solicitudes
- Acceso a estadísticas y dashboard
- Resetear contraseñas de empleados

## Seguridad

- **JWT** para autenticación con expiración configurable
- **bcrypt** para encriptación de contraseñas (factor 12)
- **Rate limiting** para prevenir ataques de fuerza bruta
- **Helmet** para headers de seguridad
- **Validación** de entrada con express-validator
- **Logs de auditoría** para todas las acciones importantes
- **CORS** configurado para dominios específicos

## Base de Datos

### Tablas Principales

1. **users** - Información de usuarios (empleados y admin)
2. **documents** - Documentos (nóminas y contratos)
3. **requests** - Solicitudes (permisos, vacaciones, bajas)
4. **audit_logs** - Logs de auditoría

### Relaciones
- Un usuario puede tener múltiples documentos
- Un usuario puede tener múltiples solicitudes
- Las solicitudes son revisadas por administradores
- Los documentos son subidos por administradores

## Desarrollo

### Scripts Disponibles
```bash
npm run dev      # Servidor con nodemon (auto-reload)
npm start        # Servidor en producción
npm test         # Ejecutar tests (por implementar)
```

### Variables de Entorno

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `PORT` | Puerto del servidor | `5000` |
| `NODE_ENV` | Entorno de ejecución | `development` |
| `DB_HOST` | Host de MySQL | `localhost` |
| `DB_USER` | Usuario de MySQL | `root` |
| `DB_PASSWORD` | Contraseña de MySQL | `` |
| `DB_NAME` | Nombre de la base de datos | `rrhh_portal` |
| `JWT_SECRET` | Secreto para JWT | **Requerido** |
| `JWT_EXPIRES_IN` | Expiración del JWT | `24h` |

## Despliegue

### Hosting Compartido (cPanel)

1. Subir archivos al directorio del dominio
2. Instalar dependencias: `npm install --production`
3. Configurar variables de entorno en `.env`
4. Crear base de datos MySQL desde cPanel
5. Configurar Node.js app desde cPanel
6. Iniciar aplicación: `node server.js`

### VPS/Servidor Dedicado

1. Clonar repositorio
2. Instalar dependencias
3. Configurar variables de entorno
4. Configurar proxy reverso (nginx/apache)
5. Usar PM2 para gestión de procesos:

```bash
npm install -g pm2
pm2 start server.js --name "rrhh-api"
pm2 startup
pm2 save
```

## Troubleshooting

### Errores Comunes

1. **Error de conexión a MySQL:**
   - Verificar credenciales en `.env`
   - Asegurar que MySQL esté ejecutándose
   - Verificar que la base de datos existe

2. **Error de JWT:**
   - Verificar que `JWT_SECRET` esté configurado
   - Verificar que el token no haya expirado

3. **Error de subida de archivos:**
   - Verificar permisos del directorio `uploads/`
   - Verificar tamaño máximo de archivo

4. **Error de email:**
   - Verificar configuración SMTP
   - Para Gmail, usar contraseña de aplicación

## Contribución

1. Fork del proyecto
2. Crear rama para feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit de cambios (`git commit -am 'Agregar nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Crear Pull Request

## Licencia

ISC License - Ver archivo LICENSE para más detalles.

## Soporte

Para soporte técnico o consultas, contactar al equipo de desarrollo.