const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  stats,
  listUsers,
  listSchools,
  suspendUser,
  reactivateUser,
  getSettings,
  updateSettings,
  auditLog,
  impersonate,
} = require('../controllers/adminController');
const ops = require('../controllers/adminOpsController');
const { balances, payoutTutor, listAll } = require('../controllers/payoutController');

const router = express.Router();

router.use(requireAuth, requireRole('super_admin'));
router.get('/stats', asyncHandler(stats));
router.get('/users', asyncHandler(listUsers));
router.get('/schools', asyncHandler(listSchools));
router.post('/users/:id/suspend', asyncHandler(suspendUser));
router.post('/users/:id/reactivate', asyncHandler(reactivateUser));
router.get('/audit-log', asyncHandler(auditLog));
router.post('/users/:id/impersonate', asyncHandler(impersonate));
router.get('/settings', asyncHandler(getSettings));
router.patch('/settings', asyncHandler(updateSettings));
router.get('/bookings', asyncHandler(ops.listBookings));
router.get('/payments', asyncHandler(ops.listPayments));
router.get('/tutors', asyncHandler(ops.listTutors));
router.get('/refunds', asyncHandler(ops.listRefunds));
router.post('/announcements', asyncHandler(ops.announce));
router.post('/users/:id/resend-verification', asyncHandler(ops.resendVerification));
router.post('/users/:id/password-reset', asyncHandler(ops.sendPasswordReset));
router.get('/payouts/balances', asyncHandler(balances));
router.get('/payouts', asyncHandler(listAll));
router.post('/payouts/tutor/:tutorId', asyncHandler(payoutTutor));

module.exports = router;
