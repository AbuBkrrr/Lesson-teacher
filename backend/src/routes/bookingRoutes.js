const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireVerified } = require('../middleware/auth');
const { create, listMine, getOne, updateStatus, reschedule, ics, callChat } = require('../controllers/bookingController');
const { upsertReport, getReport } = require('../controllers/progressController');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.post('/', requireVerified(), asyncHandler(create));
router.get('/mine', asyncHandler(listMine));
router.get('/:id/ics', asyncHandler(ics));
router.patch('/:id/schedule', requireVerified(), asyncHandler(reschedule));
router.get('/:id/call-chat', asyncHandler(callChat));
router.get('/:id/report', asyncHandler(getReport));
router.put('/:id/report', requireRole('tutor'), asyncHandler(upsertReport));
router.get('/:id', asyncHandler(getOne));
router.patch('/:id/status', requireVerified(), asyncHandler(updateStatus));

module.exports = router;
