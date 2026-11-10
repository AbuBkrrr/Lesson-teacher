const express = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../utils/asyncHandler');
const {
  signup, login, refresh, logout,
  forgotPassword, resetPassword,
  verifyEmail, resendVerification,
  deviceLinkStart, deviceLinkApprove, deviceLinkClaim, listDevices, revokeDevice,
} = require('../controllers/authController');
const { redeemInvite } = require('../controllers/childInviteController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Per-IP cap on credential endpoints. Overridable (AUTH_RATE_LIMIT_MAX) so the
// e2e suite, which legitimately makes dozens of auth calls from one IP, can
// raise it; keep the default in production.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 30 });

router.post('/signup', authLimiter, asyncHandler(signup));
router.post('/login', authLimiter, asyncHandler(login));
router.post('/refresh', asyncHandler(refresh));
router.post('/logout', asyncHandler(logout));
router.post('/child/redeem-invite', authLimiter, asyncHandler(redeemInvite));
router.post('/forgot-password', authLimiter, asyncHandler(forgotPassword));
router.post('/reset-password', authLimiter, asyncHandler(resetPassword));
router.post('/verify-email', authLimiter, asyncHandler(verifyEmail));
router.post('/resend-verification', authLimiter, requireAuth, asyncHandler(resendVerification));

router.post('/device-link/start', authLimiter, asyncHandler(deviceLinkStart));
router.post('/device-link/claim', asyncHandler(deviceLinkClaim));
router.post('/device-link/approve', authLimiter, requireAuth, asyncHandler(deviceLinkApprove));
router.get('/devices', requireAuth, asyncHandler(listDevices));
router.delete('/devices/:id', requireAuth, asyncHandler(revokeDevice));

module.exports = router;
