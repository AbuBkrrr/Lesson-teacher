// Simulates just enough of Paystack's behavior to exercise the whole
// payment → payout pipeline in development, without a live gateway.
// initializeTransaction normally returns a checkout URL the parent is
// redirected to; here we just auto-mark it as ready to "pay" via
// POST /api/payments/mock/complete, which stands in for the parent
// completing checkout on Paystack's hosted page.

const { randomUUID: uuidv4 } = require('crypto');

async function initializeTransaction({ amount, currency, email, reference, channels }) {
  return {
    provider: 'mock',
    reference: reference || `mock_${uuidv4()}`,
    authorization_url: `mock://checkout/${reference}`, // the frontend detects the mock:// scheme and shows a "Simulate payment" button instead of redirecting
    channels: channels || null, // accepted but not enforced — the mock has no real checkout page to restrict
  };
}

async function verifyTransaction({ reference }) {
  // In the mock provider, verification always reports "not yet paid"
  // until /mock/complete has been called for this reference — the
  // caller (paymentController) tracks that via the DB row's status.
  return { status: 'unknown', reference };
}

async function createTransferRecipient({ bank_code, account_number, account_name }) {
  return { recipient_code: `mock_recipient_${uuidv4()}` };
}

async function initiateTransfer({ recipient_code, amount, currency, reason }) {
  return { transfer_reference: `mock_transfer_${uuidv4()}`, status: 'success' };
}

module.exports = { initializeTransaction, verifyTransaction, createTransferRecipient, initiateTransfer };
