const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadMiddleware, upload, mine, listForTutor, purchase, remove } = require('../controllers/lessonMaterialsController');

const router = express.Router();

router.use(requireAuth);
router.post('/', requireRole('tutor'), uploadMiddleware, asyncHandler(upload));
router.get('/mine', requireRole('tutor'), asyncHandler(mine));
router.get('/tutor/:tutorId', asyncHandler(listForTutor));
router.post('/:id/purchase', requireRole('parent', 'adult_student'), asyncHandler(purchase));
router.delete('/:id', requireRole('tutor'), asyncHandler(remove));

module.exports = router;
