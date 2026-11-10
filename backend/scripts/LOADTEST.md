# Load/performance testing

`npm run loadtest` runs a short autocannon smoke test against a running
server (`npm start` first, in another terminal). It self-provisions a
throwaway account for the authenticated scenario — no setup needed beyond
the server being up and reachable.

Env vars: `BASE_URL` (default `http://localhost:4000`), `LOADTEST_DURATION`
seconds per scenario (default 10), `LOADTEST_CONNECTIONS` (default 20).

## Baseline (this sandbox, 10 connections × 5s, 3 tutor_profiles rows)

| Scenario | req/sec | p50 | p99 |
|---|---|---|---|
| GET /api/skills | ~1,965 | 4ms | 14ms |
| GET /api/tutors (cached, same query) | ~1,862 | 4ms | 12ms |
| GET /api/tutors (varied queries, cache bypassed) | ~2,265 | 3ms | 10ms |

0 errors, 0 non-2xx across all three. These numbers are sandbox-relative
(shared CPU, tiny dataset) — treat them as a regression baseline to compare
future runs against, not as production capacity figures. Re-run after any
change to a hot-path endpoint (especially `GET /api/tutors`) and watch for
p99 latency or error-rate regressions rather than the absolute req/sec.
