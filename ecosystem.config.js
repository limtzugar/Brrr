const path = require('path')
module.exports = {
  apps: [
    {
      name: 'brrr',
      script: path.join(__dirname, '.next/standalone/server.js'),
      cwd: path.join(__dirname, '.next/standalone'),
      env: {
        NODE_ENV: 'production',
        PORT: 3020,
        HOSTNAME: '0.0.0.0',
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
}
