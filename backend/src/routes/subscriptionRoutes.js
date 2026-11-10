const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { listPlans, createPlan, subscribe, mockComplete, mine, cancel } = require('../controllers/subscriptionController');

const router = express.Router();

router.get('/plans', asyncHandler(listPlans));
router.post('/plans', requireAuth, requireRole('super_admin'), asyncHandler(createPlan));
router.post('/subscribe', requireAuth, requireRole('parent', 'adult_student', 'school_admin'), asyncHandler(subscribe));
router.post('/mock/complete', asyncHandler(mockComplete));
router.get('/mine', requireAuth, requireRole('parent', 'adult_student', 'school_admin'), asyncHandler(mine));
router.post('/:id/cancel', requireAuth, asyncHandler(cancel));

module.exports = router;
