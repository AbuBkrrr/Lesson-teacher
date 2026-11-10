const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { create, listMine, submit, grade } = require('../controllers/assignmentsController');

const router = express.Router();

router.use(requireAuth);
router.post('/', requireRole('tutor'), asyncHandler(create));
router.get('/mine', asyncHandler(listMine));
router.patch('/:id/submit', requireRole('child', 'parent', 'adult_student'), asyncHandler(submit));
router.patch('/:id/grade', requireRole('tutor'), asyncHandler(grade));

module.exports = router;
