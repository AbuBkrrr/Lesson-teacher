const os = require('os');
const mediasoup = require('mediasoup');

// Codecs offered by every router. Opus for audio, VP8 for video — the
// most broadly supported pair across browsers without extra licensing
// concerns (no H.264 dependency).
const MEDIA_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  {
    kind: 'video', mimeType: 'video/VP8', clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 1000 },
  },
];

const MIN_PORT = Number(process.env.MEDIASOUP_MIN_PORT || 40000);
const MAX_PORT = Number(process.env.MEDIASOUP_MAX_PORT || 40100);

let workers = [];
let nextWorkerIndex = 0;

/**
 * Spins up one mediasoup Worker per CPU core (capped at 4 — a single
 * worker comfortably handles many simultaneous 1:1 lesson rooms, and
 * more workers than cores buys nothing). Each Worker is a real OS
 * process running mediasoup's C++ media engine, not a simulation.
 */
async function initWorkers() {
  if (workers.length > 0) return workers;

  const count = Math.min(4, Math.max(1, os.cpus().length));
  for (let i = 0; i < count; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: MIN_PORT,
      rtcMaxPort: MAX_PORT,
    });
    worker.on('died', () => {
      // A worker process crashing is fatal for the rooms it's hosting,
      // but not for the whole server — log loudly and drop it from the
      // pool so it stops being handed new rooms.
      console.error(`[sfu] mediasoup worker ${worker.pid} died — removing from pool`);
      workers = workers.filter((w) => w !== worker);
    });
    workers.push(worker);
  }
  console.log(`[sfu] ${workers.length} mediasoup worker(s) ready (ports ${MIN_PORT}-${MAX_PORT})`);
  return workers;
}

/** Round-robins rooms across the worker pool so load spreads across CPU cores. */
function getNextWorker() {
  if (workers.length === 0) throw new Error('mediasoup workers not initialized — call initWorkers() at server startup');
  const worker = workers[nextWorkerIndex];
  nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
  return worker;
}

async function closeAllWorkers() {
  await Promise.all(workers.map((w) => w.close()));
  workers = [];
}

module.exports = { initWorkers, getNextWorker, closeAllWorkers, MEDIA_CODECS };
