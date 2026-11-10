const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireVerified } = require('../middleware/auth');
const { mine, requestInstantPayout } = require('../controllers/payoutController');

const router = express.Router();

router.use(requireAuth);
router.get('/mine', asyncHandler(mine));
router.post('/instant', requireVerified(), asyncHandler(requestInstantPayout));

module.exports = router;
