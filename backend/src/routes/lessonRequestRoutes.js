const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireVerified } = require('../middleware/auth');
const {
  create,
  listOpen,
  listMine,
  close,
  apply,
  myApplications,
  acceptApplication,
  declineApplication,
} = require('../controllers/lessonRequestController');

const router = express.Router();

router.use(requireAuth);
router.post('/', requireVerified(), asyncHandler(create));
router.get('/open', asyncHandler(listOpen));
router.get('/mine', asyncHandler(listMine));
router.get('/applications/mine', asyncHandler(myApplications));
router.patch('/:id/close', asyncHandler(close));
router.post('/:id/apply', requireVerified(), asyncHandler(apply));
router.post('/:id/applications/:appId/accept', requireVerified(), asyncHandler(acceptApplication));
router.post('/:id/applications/:appId/decline', asyncHandler(declineApplication));

module.exports = router;
