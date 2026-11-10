// Thin Redis-backed cache, same conditional-init pattern as sentry.js: a
// no-op everywhere Redis isn't configured, so this never becomes a hard
// dependency for running the app. Also the natural place to later add a
// session store or a job queue (Bull/BullMQ) on the same connection.
const Redis = require('ioredis');

let client = null;
if (process.env.REDIS_URL) {
  client = new Redis(process.env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 });
  client.on('error', () => {}); // caching is best-effort — never let a Redis blip surface as a request error
}

async function getCache(key) {
  if (!client) return null;
  try {
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function setCache(key, value, ttlSeconds) {
  if (!client) return;
  try {
    await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // best-effort
  }
}

async function delCachePrefix(prefix) {
  if (!client) return;
  try {
    const keys = await client.keys(`${prefix}*`);
    if (keys.length) await client.del(keys);
  } catch {
    // best-effort
  }
}

async function quit() {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    // best-effort — tests/shutdown shouldn't hang on this
  }
}

module.exports = { getCache, setCache, delCachePrefix, quit, enabled: () => !!client };
