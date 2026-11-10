// Real Cloudinary integration. Like paystackProvider.js, this has NOT
// been exercised against the live API in this sandbox — there's no
// Cloudinary account configured here. It's written directly against
// Cloudinary's documented Node SDK (upload_stream for buffer uploads).
// Test this against your own Cloudinary credentials before relying on
// it in production.

const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const uploadMiddleware = upload.single('file');

function guessResourceType(mimetype) {
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('image/')) return 'image';
  return 'raw';
}

/**
 * Uploads the buffer multer already parsed onto req.file, and returns
 * { fileUrl, fileType } the same shape localProvider.describeUploadedFile
 * returns, so callers never need to know which provider is active.
 */
function describeUploadedFile(req, file) {
  return new Promise((resolve, reject) => {
    const resourceType = guessResourceType(file.mimetype);
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: resourceType, folder: 'lesson-teacher' },
      (error, result) => {
        if (error) return reject(error);
        resolve({
          fileUrl: result.secure_url,
          fileType: resourceType === 'raw' ? 'pdf' : resourceType,
        });
      }
    );
    stream.end(file.buffer);
  });
}

module.exports = { name: 'cloudinary', uploadMiddleware, describeUploadedFile };
