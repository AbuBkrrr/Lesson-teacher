const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { create, mine, list, resolve } = require('../controllers/refundController');

const router = express.Router();

router.post('/', requireAuth, requireRole('parent', 'adult_student'), asyncHandler(create));
router.get('/mine', requireAuth, requireRole('parent', 'adult_student'), asyncHandler(mine));
router.get('/', requireAuth, requireRole('super_admin'), asyncHandler(list));
router.patch('/:id/resolve', requireAuth, requireRole('super_admin'), asyncHandler(resolve));

module.exports = router;
