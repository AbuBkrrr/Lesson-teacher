// Prometheus metrics (scraped by Grafana/Prometheus in deployment — see
// k8s manifests). Uses prom-client's default registry plus a couple of
// app-level HTTP metrics. Kept as a single small module so app.js only
// needs two calls: metricsMiddleware() and the /metrics route handler.
const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

function metricsMiddleware() {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      // req.route is only set once Express matches a route; fall back to
      // the raw path for 404s so unmatched routes don't each mint their
      // own unbounded label (still better than nothing for visibility).
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const labels = { method: req.method, route, status_code: String(res.statusCode) };
      httpRequestDuration.observe(labels, seconds);
      httpRequestsTotal.inc(labels);
    });
    next();
  };
}

async function metricsHandler(req, res) {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}

module.exports = { register, metricsMiddleware, metricsHandler };
