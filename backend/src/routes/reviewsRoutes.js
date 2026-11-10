const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { create, listForTutor, mine, setPlatformVerified } = require('../controllers/reviewsController');

const router = express.Router();

router.post('/', requireAuth, requireRole('parent', 'adult_student'), asyncHandler(create));
router.get('/mine', requireAuth, requireRole('parent', 'adult_student'), asyncHandler(mine));
router.get('/tutor/:tutorId', asyncHandler(listForTutor));
router.post('/tutors/:tutorId/verify', requireAuth, requireRole('super_admin'), asyncHandler(setPlatformVerified));

module.exports = router;
