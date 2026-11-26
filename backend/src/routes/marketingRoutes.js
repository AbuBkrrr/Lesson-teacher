const express = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const c = require('../controllers/marketingController');

const router = express.Router();

// Public (the pitch page): generous for opens, tight for the lead form.
const openLimiter = rateLimit({ windowMs: 60 * 1000, max: Number(process.env.MARKETING_OPEN_RATE_MAX) || 60 });
const leadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: Number(process.env.MARKETING_LEAD_RATE_MAX) || 10 });

router.get('/public-config', asyncHandler(c.publicConfig));
router.post('/open', openLimiter, asyncHandler(c.open));
router.post('/leads', leadLimiter, asyncHandler(c.createLead));
router.post('/unsubscribe/:token', leadLimiter, asyncHandler(c.unsubscribe));

// Super admin only.
router.use(requireAuth, requireRole('super_admin'));
router.get('/overview', asyncHandler(c.overview));
router.get('/opens', asyncHandler(c.recentOpens));
router.post('/links', asyncHandler(c.createLink));
router.patch('/links/:id', asyncHandler(c.updateLink));
router.get('/leads', asyncHandler(c.listLeads));
router.get('/leads.csv', asyncHandler(c.leadsCsv));
router.post('/leads/email', asyncHandler(c.emailLeads));
router.get('/settings', asyncHandler(c.getSettings));
router.put('/settings', asyncHandler(c.putSettings));

module.exports = router;
