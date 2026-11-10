const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { list, create, update, remove } = require('../controllers/curriculumController');

const router = express.Router();

router.use(requireAuth);
router.get('/', asyncHandler(list));
router.post('/', requireRole('super_admin', 'school_admin'), asyncHandler(create));
router.patch('/:id', requireRole('super_admin', 'school_admin'), asyncHandler(update));
router.delete('/:id', requireRole('super_admin', 'school_admin'), asyncHandler(remove));

module.exports = router;
