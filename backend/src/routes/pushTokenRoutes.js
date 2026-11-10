const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { register, unregister } = require('../controllers/pushTokenController');

const router = express.Router();

router.use(requireAuth);
router.post('/', asyncHandler(register));
router.delete('/', asyncHandler(unregister));

module.exports = router;
