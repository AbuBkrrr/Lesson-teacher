const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const {
  initialize, uploadMiddleware, uploadProof, confirmDirectTransfer, getTransferDetails, mockComplete, webhook, mine, earningsSummary,
} = require('../controllers/paymentController');

const router = express.Router();

router.post('/webhook', asyncHandler(webhook));

router.use(requireAuth);
router.post('/initialize', asyncHandler(initialize));
router.get('/:id/transfer-details', asyncHandler(getTransferDetails));
router.post('/:id/proof', uploadMiddleware, asyncHandler(uploadProof));
router.post('/:id/confirm', asyncHandler(confirmDirectTransfer));
router.post('/mock/complete', asyncHandler(mockComplete));
router.get('/mine', asyncHandler(mine));
router.get('/earnings/summary', asyncHandler(earningsSummary));

module.exports = router;
