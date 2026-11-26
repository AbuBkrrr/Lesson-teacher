const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireVerified } = require('../middleware/auth');
const { create, listMine, updateStatus, review } = require('../controllers/auditionController');

const router = express.Router();

router.use(requireAuth);
router.post('/', requireVerified(), asyncHandler(create));
router.get('/mine', asyncHandler(listMine));
router.patch('/:id/status', requireVerified(), asyncHandler(updateStatus));
router.patch('/:id/review', asyncHandler(review));

module.exports = router;
