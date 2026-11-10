const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  uploadMiddleware,
  uploadDocument,
  startDiditSession,
  diditWebhook,
  myStatus,
  listPending,
  approve,
  reject,
} = require('../controllers/kycController');

const router = express.Router();

// Didit calls this directly — no session/auth available.
router.post('/didit/webhook', express.json(), asyncHandler(diditWebhook));

router.use(requireAuth);
router.get('/me', asyncHandler(myStatus));
router.post('/document', uploadMiddleware, asyncHandler(uploadDocument));
router.post('/didit/session', asyncHandler(startDiditSession));

router.use(requireRole('super_admin'));
router.get('/pending', asyncHandler(listPending));
router.post('/:userId/approve', asyncHandler(approve));
router.post('/:userId/reject', asyncHandler(reject));

module.exports = router;
