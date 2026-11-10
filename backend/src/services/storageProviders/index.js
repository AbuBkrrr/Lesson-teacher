const local = require('./localProvider');

function getStorageProvider() {
  const name = process.env.STORAGE_PROVIDER || 'local';
  if (name === 'cloudinary') return require('./cloudinaryProvider');
  return local;
}

module.exports = { getStorageProvider };
