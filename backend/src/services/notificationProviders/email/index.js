const consoleProvider = require('./consoleProvider');
const smtpProvider = require('./smtpProvider');

function getEmailProvider() {
  const name = process.env.NOTIFICATION_EMAIL_PROVIDER || 'console';
  if (name === 'smtp') return { name: 'smtp', ...smtpProvider };
  return { name: 'console', ...consoleProvider };
}

module.exports = { getEmailProvider };
