const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { list, create, remove, mine, addMine, removeMine } = require('../controllers/skillsController');

const router = express.Router();

router.get('/', asyncHandler(list));
router.post('/', requireAuth, requireRole('super_admin'), asyncHandler(create));
router.delete('/:id', requireAuth, requireRole('super_admin'), asyncHandler(remove));

router.get('/mine', requireAuth, requireRole('tutor'), asyncHandler(mine));
router.post('/mine', requireAuth, requireRole('tutor'), asyncHandler(addMine));
router.delete('/mine/:skillId', requireAuth, requireRole('tutor'), asyncHandler(removeMine));

module.exports = router;
