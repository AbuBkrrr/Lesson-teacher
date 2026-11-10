const mock = require('./mockProvider');
const paystack = require('./paystackProvider');
const payscrow = require('./payscrowProvider');

function getProvider() {
  const name = process.env.PAYMENT_PROVIDER || 'mock';
  if (name === 'paystack') return { name: 'paystack', ...paystack };
  if (name === 'payscrow') return { name: 'payscrow', ...payscrow };
  return { name: 'mock', ...mock };
}

module.exports = { getProvider };
