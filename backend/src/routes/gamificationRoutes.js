const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const {
  listBadgeCatalog, childBadges, childStreak, siblingLeaderboard, schoolLeaderboard,
} = require('../controllers/gamificationController');

const router = express.Router();

router.get('/badges', asyncHandler(listBadgeCatalog));
router.get('/children/:childId/badges', requireAuth, asyncHandler(childBadges));
router.get('/children/:childId/streak', requireAuth, asyncHandler(childStreak));
router.get('/leaderboard/siblings', requireAuth, asyncHandler(siblingLeaderboard));
router.get('/leaderboard/school', requireAuth, asyncHandler(schoolLeaderboard));

module.exports = router;
