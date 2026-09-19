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
    time: true,
    env: { NODE_ENV: "production", PORT: 3000 }
  }]
};
