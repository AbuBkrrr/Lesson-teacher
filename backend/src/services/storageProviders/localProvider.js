// Saves uploaded files to disk under /uploads and serves them via
// express.static (wired up in app.js). This is the default provider —
// it works with zero external accounts, which matters for anyone
// running this project for the first time.

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB — generous enough for lesson PDFs/short videos, not unlimited
});

/** Express middleware for a single-file upload under form field name "file". */
const uploadMiddleware = upload.single('file');

/** Turns the multer file object into a public URL + inferred type, after upload middleware has run. */
function describeUploadedFile(req, file) {
  const base = `${req.protocol}://${req.get('host')}`;
  const fileUrl = `${base}/uploads/${file.filename}`;
  const fileType = guessFileType(file.mimetype);
  return { fileUrl, fileType };
}

function guessFileType(mimetype) {
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype === 'application/pdf') return 'pdf';
  return 'other';
}

module.exports = { name: 'local', uploadMiddleware, describeUploadedFile };
