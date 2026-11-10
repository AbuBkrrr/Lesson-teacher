const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { pull, push } = require('../controllers/syncController');

const router = express.Router();

router.use(requireAuth);
router.get('/pull', asyncHandler(pull));
router.post('/push', asyncHandler(push));

module.exports = router;
