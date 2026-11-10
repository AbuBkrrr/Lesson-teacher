const consoleProvider = require('./consoleProvider');
const fcmProvider = require('./fcmProvider');

function getPushProvider() {
  const name = process.env.NOTIFICATION_PUSH_PROVIDER || 'console';
  if (name === 'fcm') return { name: 'fcm', ...fcmProvider };
  return { name: 'console', ...consoleProvider };
}

module.exports = { getPushProvider };
