require('dotenv').config();
const http = require('http');
const { createApp } = require('./app');
const { initSocket } = require('./realtime/socket');
const { initWorkers } = require('./services/sfu/workerPool');
const db = require('./config/db'); // starts applying the Postgres schema immediately

const app = createApp();
const httpServer = http.createServer(app);
const io = initSocket(httpServer);
app.set('io', io); // controllers reach this via req.app.get('io') to push real-time events

const PORT = process.env.PORT || 4000;

Promise.all([db.ready(), initWorkers()])
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`Lesson Teacher API (Postgres) listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start: database or mediasoup workers not ready', err);
    process.exit(1);
  });

// Graceful shutdown: k8s sends SIGTERM on every rollout. Stop accepting
// connections, let in-flight requests finish, close sockets and the DB pool.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 15000);
  force.unref();
  io.close();
  httpServer.close(() => {
    db.pool.end().catch(() => {}).finally(() => process.exit(0));
  });
}
const purgeTimer = setInterval(() => require('./controllers/conversationController').purgeExpiredMessages().catch((e) => console.error('purge failed', e)), 5 * 60 * 1000);
purgeTimer.unref();
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));
