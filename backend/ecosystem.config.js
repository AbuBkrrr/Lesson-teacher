/**
 * PM2 process file (used by the Docker image via pm2-runtime, or directly
 * on a VPS without Docker: `pm2 start ecosystem.config.js --env production`).
 *
 * The API runs as ONE process in fork mode on purpose: live lesson rooms
 * (mediasoup routers, whiteboard state) live in that process's memory, so
 * PM2 cluster mode would split participants of one lesson across processes.
 * mediasoup already uses every CPU core through its own worker processes.
 */
module.exports = {
  apps: [
    {
      name: 'lesson-teacher-api',
      script: 'src/server.js',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: process.env.API_MAX_MEMORY || '700M',
      kill_timeout: 10000,
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },
    },
    {
      // Sends "your lesson starts soon" reminders. One-shot script, run every 5 minutes.
      name: 'lesson-reminders',
      script: 'scripts/sendLessonReminders.js',
      cron_restart: '*/5 * * * *',
      autorestart: false,
      instances: 1,
      env_production: { NODE_ENV: 'production' },
    },
  ],
};
