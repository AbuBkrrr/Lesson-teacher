const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getOrCreate, listMessages, sendMessage, editMessage, deleteMessage, reactToMessage, updateSettings, exportChats, presence, myConversations, monitor, markRead, unreadCount } = require('../controllers/conversationController');

const { getStorageProvider } = require('../services/storageProviders');
// Only multipart requests carry a file; plain JSON sends skip multer entirely.
const maybeUpload = (req, res, next) => (req.is('multipart/form-data') ? getStorageProvider().uploadMiddleware(req, res, next) : next());

const router = express.Router();

router.use(requireAuth);
// Role-fine-grained checks (who can send in which conversation kind,
// whether a child_id belongs to this caller, etc.) happen inside the
// controller, since they depend on the conversation's kind — the
// route layer here just excludes roles that can never touch this at all.
router.post('/', requireRole('child', 'tutor', 'parent', 'adult_student'), asyncHandler(getOrCreate));
router.get('/mine', requireRole('child', 'tutor', 'parent', 'adult_student'), asyncHandler(myConversations));
router.get('/unread-count', asyncHandler(unreadCount));
router.get('/monitor', requireRole('parent'), asyncHandler(monitor));
router.get('/:id/messages', asyncHandler(listMessages));
router.post('/:id/messages', requireRole('child', 'tutor', 'parent', 'adult_student'), maybeUpload, asyncHandler(sendMessage));
router.put('/:id/messages/:messageId/reaction', requireRole('child', 'tutor', 'parent', 'adult_student'), asyncHandler(reactToMessage));
router.patch('/:id/settings', requireRole('tutor', 'parent', 'adult_student'), asyncHandler(updateSettings));
router.get('/export', asyncHandler(exportChats));
router.get('/:id/presence', asyncHandler(presence));
router.patch('/:id/messages/:messageId', requireRole('child', 'tutor', 'parent', 'adult_student'), asyncHandler(editMessage));
router.delete('/:id/messages/:messageId', requireRole('child', 'tutor', 'parent', 'adult_student'), asyncHandler(deleteMessage));
router.post('/:id/read', asyncHandler(markRead));

module.exports = router;
