// Real Paystack integration. This sandbox can't reach api.paystack.co
// (network here is restricted to npm/GitHub/PyPI), so this has NOT been
// exercised against the live API — it's written directly against
// Paystack's documented REST endpoints and response shapes. Test this
// against Paystack's test-mode keys before going live.

const PAYSTACK_BASE = 'https://api.paystack.co';

function secretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not set');
  return key;
}

async function paystackFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!data.status) {
    const err = new Error(data.message || 'Paystack request failed');
    err.paystack = data;
    throw err;
  }
  return data.data;
}

/**
 * Kicks off a hosted checkout. amount must be in the smallest currency
 * unit (kobo for NGN, cents for others) — Paystack's convention.
 *
 * `channels` optionally restricts which payment channels Paystack's
 * hosted checkout page offers (e.g. ['card'] or ['ussd']). Omit it to
 * let Paystack show its full default set (card, bank, USSD, transfer,
 * etc.) — used for the generic "payment gateway" option.
 */
async function initializeTransaction({ amount, currency, email, reference, channels }) {
  const body = { amount: Math.round(amount * 100), currency, email, reference };
  if (channels && channels.length > 0) body.channels = channels;

  const data = await paystackFetch('/transaction/initialize', { method: 'POST', body });
  return { provider: 'paystack', reference: data.reference, authorization_url: data.authorization_url };
}

async function verifyTransaction({ reference }) {
  const data = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`);
  return { status: data.status === 'success' ? 'successful' : data.status, reference, raw: data };
}

async function createTransferRecipient({ bank_code, account_number, account_name, currency }) {
  const data = await paystackFetch('/transferrecipient', {
    method: 'POST',
    body: { type: 'nuban', name: account_name, account_number, bank_code, currency: currency || 'NGN' },
  });
  return { recipient_code: data.recipient_code };
}

async function initiateTransfer({ recipient_code, amount, currency, reason }) {
  const data = await paystackFetch('/transfer', {
    method: 'POST',
    body: { source: 'balance', amount: Math.round(amount * 100), recipient: recipient_code, reason, currency },
  });
  return { transfer_reference: data.reference, status: data.status };
}

/** Verifies the X-Paystack-Signature header on incoming webhooks. */
function verifyWebhookSignature(rawBody, signatureHeader) {
  const crypto = require('crypto');
  const hash = crypto.createHmac('sha512', secretKey()).update(rawBody).digest('hex');
  return hash === signatureHeader;
}

module.exports = {
  initializeTransaction,
  verifyTransaction,
  createTransferRecipient,
  initiateTransfer,
  verifyWebhookSignature,
};
