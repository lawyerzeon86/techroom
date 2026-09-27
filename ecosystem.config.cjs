module.exports = {
  apps: [
    {
      name: 'techroom',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000 -H 127.0.0.1',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: '3000'
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      time: true
    }
  ]
};
