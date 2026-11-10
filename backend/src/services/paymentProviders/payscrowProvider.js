// Payscrow escrow payment integration. This sandbox can't reach the
// live Payscrow API (network here is restricted to npm/GitHub/PyPI),
// so this has NOT been exercised against the real API — it's written
// against Payscrow's documented REST endpoints and response shapes.
// Test against Payscrow's test/sandbox keys before going live.
//
// Payscrow is escrow-first: funds collected from the parent are held
// by Payscrow and only released to the tutor's linked account once the
// transaction is explicitly released (we trigger that release at the
// same point the rest of the app currently triggers a payout, i.e.
// after a lesson/booking is confirmed complete) — this matches the
// platform's existing hold-then-payout flow, so no change to booking
// logic is needed, only to which provider calls `initiateTransfer`
// (release) and `verifyTransaction` (status check) actually hit.

const PAYSCROW_BASE = process.env.PAYSCROW_BASE_URL || 'https://api.payscrow.com/v2';

function secretKey() {
  const key = process.env.PAYSCROW_SECRET_KEY;
  if (!key) throw new Error('PAYSCROW_SECRET_KEY is not set');
  return key;
}

async function payscrowFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${PAYSCROW_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok || data.status === false) {
    const err = new Error(data.message || 'Payscrow request failed');
    err.payscrow = data;
    throw err;
  }
  return data.data || data;
}

/**
 * Kicks off a hosted escrow checkout. amount is in the currency's
 * major unit (Payscrow, unlike Paystack, does not use kobo/cents).
 */
async function initializeTransaction({ amount, currency, email, reference }) {
  const data = await payscrowFetch('/transaction/initialize', {
    method: 'POST',
    body: { amount, currency: currency || 'NGN', email, reference, title: 'Lesson Teacher booking payment' },
  });
  return { provider: 'payscrow', reference: data.reference || reference, authorization_url: data.authorization_url || data.checkout_url };
}

async function verifyTransaction({ reference }) {
  const data = await payscrowFetch(`/transaction/verify/${encodeURIComponent(reference)}`);
  const raw = data.status;
  const status = raw === 'success' || raw === 'funded' ? 'successful' : raw;
  return { status, reference, raw: data };
}

/**
 * Payscrow pays out to a bank account tied to the transaction at
 * release time rather than a separately-created "recipient" object,
 * but the rest of the app expects a recipient_code it can store once
 * and reuse — so we mint one by registering the tutor's bank details
 * and keep its id as that code.
 */
async function createTransferRecipient({ bank_code, account_number, account_name, currency }) {
  const data = await payscrowFetch('/payout-account', {
    method: 'POST',
    body: { bank_code, account_number, account_name, currency: currency || 'NGN' },
  });
  return { recipient_code: data.id || data.account_id };
}

/** Releases held escrow funds to the tutor's linked payout account. */
async function initiateTransfer({ recipient_code, amount, currency, reason }) {
  const data = await payscrowFetch('/transaction/release', {
    method: 'POST',
    body: { payout_account_id: recipient_code, amount, currency, reason },
  });
  return { transfer_reference: data.reference, status: data.status };
}

/** Verifies the X-Payscrow-Signature header on incoming webhooks. */
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
