const consoleProvider = require('./consoleProvider');
const twilioProvider = require('./twilioProvider');

function getSmsProvider() {
  const name = process.env.NOTIFICATION_SMS_PROVIDER || 'console';
  if (name === 'twilio') return { name: 'twilio', ...twilioProvider };
  return { name: 'console', ...consoleProvider };
}

module.exports = { getSmsProvider };
