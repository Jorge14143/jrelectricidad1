module.exports = {
  apps: [{
    name: "jr-electricidad",
    script: "./server.js",
    cwd: __dirname,
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    max_memory_restart: "512M",
    min_uptime: "10s",
    max_restarts: 10,
    restart_delay: 3000,
    kill_timeout: 10000,
    time: true,
    env: {
      NODE_ENV: "production"
    }
  }]
};
