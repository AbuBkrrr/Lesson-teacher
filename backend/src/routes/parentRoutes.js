const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { dashboard } = require('../controllers/parentController');

const router = express.Router();

router.use(requireAuth);
router.get('/me/dashboard', requireRole('parent', 'adult_student'), asyncHandler(dashboard));

module.exports = router;
