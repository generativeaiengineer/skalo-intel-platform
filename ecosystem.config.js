module.exports = {
  apps: [{
    name: 'skalo-intel',
    script: 'server.js',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    watch: false,
    max_memory_restart: '300M',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    time: true,
    restart_delay: 3000,
    max_restarts: 10,
  }],
};
