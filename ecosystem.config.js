module.exports = {
  apps: [{
    name: 'zetansau-rrhh',
    script: 'server.js',
    cwd: '/var/www/rrhh/backend',
    instances: 'max', // Usar todos los cores disponibles
    exec_mode: 'cluster',
    
    // Variables de entorno
    env: {
      NODE_ENV: 'development',
      PORT: 5000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    
    // Configuración de logs
    log_file: '/var/log/zetansau-rrhh/combined.log',
    out_file: '/var/log/zetansau-rrhh/out.log',
    error_file: '/var/log/zetansau-rrhh/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Configuración de reinicio automático
    autorestart: true,
    watch: false, // No watch en producción
    max_memory_restart: '1G',
    
    // Configuración de reinicio
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '10s',
    
    // Configuración de cluster
    kill_timeout: 5000,
    listen_timeout: 3000,
    
    // Variables de entorno específicas
    node_args: '--max-old-space-size=1024',
    
    // Configuración de monitoreo
    monitoring: false, // Cambiar a true si usas PM2 Plus
    
    // Configuración de merge logs
    merge_logs: true,
    
    // Configuración de tiempo
    time: true,
    
    // Configuración de source map
    source_map_support: false,
    
    // Configuración de interpretador
    interpreter: 'node',
    
    // Configuración de argumentos
    args: [],
    
    // Configuración de cron para restart (opcional)
    // cron_restart: '0 2 * * *', // Restart diario a las 2 AM
    
    // Configuración de ignore watch
    ignore_watch: [
      'node_modules',
      'uploads',
      'logs',
      '.git'
    ],
    
    // Configuración de watch options
    watch_options: {
      followSymlinks: false,
      usePolling: false
    },
    
    // Configuración de instancias
    instance_var: 'INSTANCE_ID',
    
    // Configuración de incremento de puerto
    increment_var: 'PORT',
    
    // Configuración de espera entre instancias
    wait_ready: true,
    
    // Configuración de timeout para ready
    ready_timeout: 3000,
    
    // Configuración de shutdown
    shutdown_with_message: true,
    
    // Configuración de kill signal
    kill_signal: 'SIGINT',
    
    // Configuración de post deploy
    post_update: [
      'npm install --production',
      'echo "Deployment completado"'
    ]
  }],
  
  // Configuración de deployment
  deploy: {
    production: {
      user: 'deploy',
      host: 'zetansau.com',
      ref: 'origin/main',
      repo: 'git@github.com:tu-usuario/zetansau-rrhh.git', // Cambiar por tu repo
      path: '/var/www/rrhh',
      'pre-deploy-local': '',
      'post-deploy': 'npm install --production && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
      'ssh_options': 'StrictHostKeyChecking=no'
    }
  }
};