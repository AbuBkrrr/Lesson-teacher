const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { myReferrals, unresolved, resolve } = require('../controllers/referralController');

const router = express.Router();

router.use(requireAuth);
router.get('/me', asyncHandler(myReferrals));
router.get('/unresolved', requireRole('super_admin'), asyncHandler(unresolved));
router.post('/:id/resolve', requireRole('super_admin'), asyncHandler(resolve));

module.exports = router;
