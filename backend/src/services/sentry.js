// Sentry error tracking. Entirely no-op when SENTRY_DSN isn't set (local
// dev and tests never need a real Sentry project), so every call here is
// safe to make unconditionally from app.js.
const Sentry = require('@sentry/node');

const enabled = !!process.env.SENTRY_DSN;

if (enabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
  });
}

module.exports = { Sentry, enabled };
