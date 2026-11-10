const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { list, myProfile, updateMyProfile, updateBankAccount, recommended, introVideoMiddleware, uploadIntroVideo, removeIntroVideo } = require('../controllers/tutorController');
const { listMine: listMyAvailability, replaceMine: replaceMyAvailability, getForTutor: getTutorAvailability } = require('../controllers/tutorAvailabilityController');
const { add: addFavorite, remove: removeFavorite, listMine: listMyFavorites } = require('../controllers/tutorFavoritesController');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(list));
router.get('/recommended', requireAuth, requireRole('parent', 'adult_student'), asyncHandler(recommended));
router.get('/me', requireAuth, requireRole('tutor'), asyncHandler(myProfile));
router.put('/me', requireAuth, requireRole('tutor'), asyncHandler(updateMyProfile));
router.post('/me/intro-video', requireAuth, requireRole('tutor'), introVideoMiddleware, asyncHandler(uploadIntroVideo));
router.delete('/me/intro-video', requireAuth, requireRole('tutor'), asyncHandler(removeIntroVideo));
router.put('/me/bank-account', requireAuth, requireRole('tutor'), asyncHandler(updateBankAccount));
// Must stay ahead of the '/:id/availability' route below — '/me/availability'
// would otherwise also match ':id' = 'me'.
router.get('/me/availability', requireAuth, requireRole('tutor'), asyncHandler(listMyAvailability));
router.put('/me/availability', requireAuth, requireRole('tutor'), asyncHandler(replaceMyAvailability));
router.get('/:id/availability', requireAuth, asyncHandler(getTutorAvailability));

// Must stay ahead of '/:id/favorite' for the same reason as above.
router.get('/favorites/mine', requireAuth, requireRole('parent', 'adult_student'), asyncHandler(listMyFavorites));
router.post('/:id/favorite', requireAuth, requireRole('parent', 'adult_student'), asyncHandler(addFavorite));
router.delete('/:id/favorite', requireAuth, requireRole('parent', 'adult_student'), asyncHandler(removeFavorite));

module.exports = router;
