const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { listMine, create, update, remove, myRecord } = require('../controllers/childrenController');
const { createInvite } = require('../controllers/childInviteController');

const router = express.Router();

// Child-only route — must be registered before the parent-only .use() gate below.
router.get('/me', requireAuth, requireRole('child'), asyncHandler(myRecord));

router.use(requireAuth, requireRole('parent'));
router.get('/mine', asyncHandler(listMine));
router.post('/', asyncHandler(create));
router.patch('/:id', asyncHandler(update));
router.delete('/:id', asyncHandler(remove));
router.post('/:id/invite', asyncHandler(createInvite));

module.exports = router;
