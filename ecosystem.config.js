module.exports = {
  apps: [
    {
      name: 'simt-wa-gateway',
      script: 'dist/index.js',
      instances: 1,           // WA Gateway harus 1 instance (stateful)
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'development',
        PORT: 8081,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8081,
      },
      // Log config
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      // Restart strategy
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
