const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const c = require('../controllers/notificationController');

const router = express.Router();
router.use(requireAuth);
router.get('/', asyncHandler(c.list));
router.get('/unread-count', asyncHandler(c.unreadCount));
router.post('/read-all', asyncHandler(c.markAllRead));
router.patch('/:id/read', asyncHandler(c.markRead));

module.exports = router;
