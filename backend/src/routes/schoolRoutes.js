const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { mySchool, updateMySchool, myChildren, addChild, lookupParent } = require('../controllers/schoolController');

const router = express.Router();

router.use(requireAuth, requireRole('school_admin', 'super_admin'));
router.get('/me', asyncHandler(mySchool));
router.patch('/me', asyncHandler(updateMySchool));
router.get('/me/children', asyncHandler(myChildren));
router.post('/me/children', asyncHandler(addChild));
router.get('/me/parent-lookup', asyncHandler(lookupParent));

module.exports = router;
