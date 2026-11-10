const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { childProgress, myProgress, familyProgress } = require('../controllers/progressController');

const router = express.Router();

router.use(requireAuth);
router.get('/me', requireRole('child'), asyncHandler(myProgress));
router.get('/family', requireRole('parent'), asyncHandler(familyProgress));
router.get('/children/:childId', asyncHandler(childProgress));

module.exports = router;
