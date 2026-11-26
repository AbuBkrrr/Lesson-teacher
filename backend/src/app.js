const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const { Sentry, enabled: sentryEnabled } = require('./services/sentry');
const { metricsMiddleware, metricsHandler } = require('./services/metrics');

const authRoutes = require('./routes/authRoutes');
const syncRoutes = require('./routes/syncRoutes');
const referralRoutes = require('./routes/referralRoutes');
const schoolRoutes = require('./routes/schoolRoutes');
const adminRoutes = require('./routes/adminRoutes');
const tutorRoutes = require('./routes/tutorRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const auditionRoutes = require('./routes/auditionRoutes');
const childrenRoutes = require('./routes/childrenRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const payoutRoutes = require('./routes/payoutRoutes');
const skillsRoutes = require('./routes/skillsRoutes');
const conversationRoutes = require('./routes/conversationRoutes');
const curriculumRoutes = require('./routes/curriculumRoutes');
const lessonMaterialsRoutes = require('./routes/lessonMaterialsRoutes');
const assignmentsRoutes = require('./routes/assignmentsRoutes');
const parentRoutes = require('./routes/parentRoutes');
const reviewsRoutes = require('./routes/reviewsRoutes');
const gamificationRoutes = require('./routes/gamificationRoutes');
const refundRoutes = require('./routes/refundRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const kycRoutes = require('./routes/kycRoutes');
const lessonRequestRoutes = require('./routes/lessonRequestRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const pushTokenRoutes = require('./routes/pushTokenRoutes');
const accountRoutes = require('./routes/accountRoutes');
const progressRoutes = require('./routes/progressRoutes');
const marketingRoutes = require('./routes/marketingRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  // contentSecurityPolicy is for HTML pages; this is a JSON API (plus static
  // /uploads file serving), so it's off. crossOriginResourcePolicy is relaxed
  // to cross-origin so the portal/mobile apps (different origins) can load
  // uploaded images and files served from here.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // CORS_ORIGINS (comma-separated) restricts browser origins; unset = allow all
  // (dev default). Native mobile apps don't send an Origin, so they're unaffected.
  const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  app.use(cors(corsOrigins.length ? { origin: corsOrigins } : undefined));
  // Behind an ingress/load balancer req.ip is the proxy's; without this the
  // auth rate limiter would count every user as one client.
  app.set('trust proxy', process.env.TRUST_PROXY ? (Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY) : (process.env.NODE_ENV === 'production' ? 1 : false));
  app.use(express.json({ limit: '1mb' }));
  app.use(metricsMiddleware());
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  }

  // Serves files saved by the local storage provider (see
  // src/services/storageProviders/localProvider.js). Not used at all
  // when STORAGE_PROVIDER=cloudinary, since files live on Cloudinary's
  // CDN instead.
  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.get('/metrics', metricsHandler);

  app.use('/api/auth', authRoutes);
  app.use('/api/sync', syncRoutes);
  app.use('/api/referrals', referralRoutes);
  app.use('/api/schools', schoolRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/tutors', tutorRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/auditions', auditionRoutes);
  app.use('/api/children', childrenRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/payouts', payoutRoutes);
  app.use('/api/skills', skillsRoutes);
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/curriculum', curriculumRoutes);
  app.use('/api/lesson-materials', lessonMaterialsRoutes);
  app.use('/api/assignments', assignmentsRoutes);
  app.use('/api/parents', parentRoutes);
  app.use('/api/reviews', reviewsRoutes);
  app.use('/api/gamification', gamificationRoutes);
  app.use('/api/refund-requests', refundRoutes);
  app.use('/api/subscriptions', subscriptionRoutes);
  app.use('/api/kyc', kycRoutes);
  app.use('/api/lesson-requests', lessonRequestRoutes);
  app.use('/api/push-tokens', pushTokenRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/account', accountRoutes);
  app.use('/api/progress', progressRoutes);
  app.use('/api/marketing', marketingRoutes);

  app.use(notFound);
  // Reports uncaught route errors to Sentry (no-op when SENTRY_DSN isn't
  // set) before our own JSON error handler sends the response.
  if (sentryEnabled) Sentry.setupExpressErrorHandler(app);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
