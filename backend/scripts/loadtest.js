#!/usr/bin/env node
// Lightweight load/performance smoke test. Not a full k6/Gatling rig —
// deliberately so: autocannon needs no extra infra (no separate load-gen
// service to run/maintain) and this covers what actually matters for a
// marketplace API — read-heavy browse endpoints under concurrency, and
// that the Redis cache (see src/services/cache.js) measurably helps.
//
// Usage: BASE_URL=http://localhost:4000 node scripts/loadtest.js
// Expects the server to already be running (npm start) against a DB with
// at least a little seed data — run `npm run seed` first if it's empty.
const autocannon = require('autocannon');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
const DURATION = Number(process.env.LOADTEST_DURATION) || 10; // seconds per scenario
const CONNECTIONS = Number(process.env.LOADTEST_CONNECTIONS) || 20;

// /api/tutors requires auth — self-provision a throwaway parent account
// rather than asking the operator to paste in a token.
async function getAuthToken() {
  const email = `loadtest-${Date.now()}@example.com`;
  const res = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'parent', full_name: 'Load Test', email, password: 'TestPass123' }),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`Could not provision a load-test account: ${JSON.stringify(body)}`);
  return body.access_token;
}

function run(opts) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({ url: BASE_URL, duration: DURATION, connections: CONNECTIONS, ...opts }, (err, result) => {
      if (err) reject(err); else resolve(result);
    });
    autocannon.track(instance, { renderProgressBar: false });
  });
}

function summarize(name, result) {
  const { latency, requests, errors, non2xx } = result;
  return {
    scenario: name,
    'req/sec (avg)': requests.average,
    'latency p50 (ms)': latency.p50,
    'latency p99 (ms)': latency.p99,
    errors,
    non2xx,
  };
}

async function main() {
  console.log(`Load-testing ${BASE_URL} — ${CONNECTIONS} connections × ${DURATION}s per scenario\n`);
  const token = await getAuthToken();
  const authHeaders = { authorization: `Bearer ${token}` };
  const rows = [];

  // 1. Public, unauthenticated, uncached — lower bound / baseline throughput.
  rows.push(summarize('GET /api/skills', await run({ requests: [{ path: '/api/skills' }] })));

  // 2. The tutor-search endpoint, hit repeatedly with the SAME query — after
  // the first request this should be served from the Redis cache (TTL 30s
  // by default), so throughput here is really measuring cache-hit path cost.
  rows.push(
    summarize(
      'GET /api/tutors (cached, same query)',
      await run({ headers: authHeaders, requests: [{ path: '/api/tutors?page=1&page_size=20' }] })
    )
  );

  // 3. Same endpoint, but a different query per request — forces a DB hit
  // every time (cache key includes the full query string), so this is the
  // realistic worst case for the search endpoint under load.
  rows.push(
    summarize(
      'GET /api/tutors (varied queries, cache bypassed)',
      await run({
        headers: authHeaders,
        requests: [1, 2, 3, 4, 5].map((page) => ({ path: `/api/tutors?page=${page}` })),
      })
    )
  );

  console.table(rows);
  console.log('\nFor context: p99 latency and req/sec are the numbers that matter most for user-facing endpoints.');
}

main().catch((err) => {
  console.error('Load test failed:', err.message);
  console.error('Is the server running? Try: npm start (in another terminal), then re-run this script.');
  process.exit(1);
});
