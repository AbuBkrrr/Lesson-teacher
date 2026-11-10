const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { exportData, deleteAccount } = require('../controllers/accountController');

const router = express.Router();

router.use(requireAuth);
router.get('/export', asyncHandler(exportData));
router.post('/delete', asyncHandler(deleteAccount));

module.exports = router;
