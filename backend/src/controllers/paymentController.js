const db = require('../config/db');
const { getPaging, pageMeta } = require('../utils/paging');
const { uuidv4 } = require('../utils/referral');
const { getProvider } = require('../services/paymentProviders');
const { getStorageProvider } = require('../services/storageProviders');
const { getCommissionPercent, getSetting } = require('../utils/settings');
const { notifyUser, templates } = require('../services/notifications');

function now() {
  return new Date().toISOString();
}

const METHODS = ['direct_transfer', 'card', 'ussd', 'gateway'];

// How each checkout method maps to the channels we ask the gateway to
// offer. 'gateway' is the catch-all — no restriction, gateway shows its
// full default set (card, bank, USSD, transfer, etc.).
const METHOD_CHANNELS = {
  card: ['card'],
  ussd: ['ussd'],
  gateway: null,
};

function uploadMiddleware(req, res, next) {
  return getStorageProvider().uploadMiddleware(req, res, next);
}

/** POST /api/payments/initialize  (parent)  body: { booking_id, method? } */
async function initialize(req, res) {
  if (!['parent', 'adult_student'].includes(req.user.role)) return res.status(403).json({ error: 'Only parents or adult students can pay for a booking' });

  const { booking_id, method = 'gateway' } = req.body || {};
  if (!METHODS.includes(method)) {
    return res.status(400).json({ error: `method must be one of: ${METHODS.join(', ')}` });
  }

  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND parent_id = ? AND deleted_at IS NULL').get(booking_id, req.user.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.status !== 'confirmed') {
    return res.status(400).json({ error: 'This booking must be confirmed by the tutor before it can be paid for' });
  }

  // A pending *gateway* payment (card/ussd/gateway) doesn't block a retry — there's no
  // webhook for "the parent abandoned checkout", so treating it as blocking would lock
  // the booking forever. A pending *direct transfer* is different: instructions have
  // already been issued and don't expire, so a second one would just be a duplicate.
  const existingPaid = await db
    .prepare(
      `SELECT id FROM payments WHERE booking_id = ?
       AND (status IN ('successful','awaiting_confirmation') OR (status = 'pending' AND method = 'direct_transfer'))`
    )
    .get(booking_id);
  if (existingPaid) return res.status(400).json({ error: 'This booking already has a payment in progress or completed' });

  const tutorProfile = await db.prepare('SELECT * FROM tutor_profiles WHERE user_id = ?').get(booking.tutor_id);
  const parent = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  // Bookings made since lesson pricing was stored carry their own price
  // (rate x duration, fixed at booking time); older rows fall back to the rate.
  const baseAmount = booking.price !== null && booking.price !== undefined ? Number(booking.price) : tutorProfile?.hourly_rate;
  const currency = booking.currency || tutorProfile?.currency || 'NGN';
  if (!baseAmount) return res.status(400).json({ error: "This tutor hasn't set an hourly rate yet" });

  // Family-plan discount: a parent with 2+ active children gets a
  // discount off the lesson price itself (not the platform's commission),
  // automatically applied at checkout — no code or opt-in required.
  const siblingCount = Number(
    (await db.prepare("SELECT COUNT(*) AS count FROM children WHERE parent_id = ? AND deleted_at IS NULL").get(req.user.id)).count
  );
  const siblingDiscountPercent = siblingCount >= 2 ? Number(await getSetting('sibling_discount_percent')) : 0;
  const amount = siblingDiscountPercent > 0
    ? Math.round(baseAmount * (1 - siblingDiscountPercent / 100) * 100) / 100
    : baseAmount;

  const commissionPercent = await getCommissionPercent();
  const platformFee = Math.round(amount * (commissionPercent / 100) * 100) / 100;
  const tutorAmount = Math.round((amount - platformFee) * 100) / 100;

  const paymentId = uuidv4();
  const ts = now();

  // Direct transfer never touches the gateway: the parent pays into the
  // platform's bank account directly and uploads proof, which a tutor or
  // admin later confirms via POST /:id/confirm.
  if (method === 'direct_transfer') {
    const reference = `manual_${paymentId}`;
    const bankName = await getSetting('transfer_bank_name');
    const accountNumber = await getSetting('transfer_account_number');
    const accountName = await getSetting('transfer_account_name');
    if (!bankName || !accountNumber || !accountName) {
      return res.status(400).json({ error: 'Direct transfer is not set up yet — the platform has not configured a bank account' });
    }

    await db.prepare(
      `INSERT INTO payments (
         id, booking_id, parent_id, tutor_id, amount, currency, platform_fee, tutor_amount,
         provider, provider_reference, status, method, initiated_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, 'pending', 'direct_transfer', ?, ?, ?)`
    ).run(
      paymentId, booking_id, req.user.id, booking.tutor_id, amount, currency, platformFee, tutorAmount,
      reference, ts, ts, ts
    );

    return res.status(201).json({
      payment_id: paymentId,
      reference,
      method: 'direct_transfer',
      amount, currency,
      sibling_discount_percent: siblingDiscountPercent,
      transfer_instructions: { bank_name: bankName, account_number: accountNumber, account_name: accountName },
    });
  }

  const provider = getProvider();
  const reference = `pay_${paymentId}`;

  const init = await provider.initializeTransaction({
    amount,
    currency,
    email: parent.email || `${parent.phone}@no-email.lessonteacher.local`,
    reference,
    channels: METHOD_CHANNELS[method],
  });

  await db.prepare(
    `INSERT INTO payments (
       id, booking_id, parent_id, tutor_id, amount, currency, platform_fee, tutor_amount,
       provider, provider_reference, status, method, initiated_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
  ).run(
    paymentId, booking_id, req.user.id, booking.tutor_id, amount, currency, platformFee, tutorAmount,
    provider.name, init.reference, method, ts, ts, ts
  );

  res.status(201).json({
    payment_id: paymentId,
    reference: init.reference,
    method,
    authorization_url: init.authorization_url,
    amount, currency,
    sibling_discount_percent: siblingDiscountPercent,
  });
}

/**
 * POST /api/payments/:id/proof  (parent, owner of the payment)
 * multipart/form-data: file  — proof of a direct bank transfer.
 */
async function uploadProof(req, res) {
  const { id } = req.params;
  const payment = await db.prepare('SELECT * FROM payments WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.parent_id !== req.user.id) return res.status(403).json({ error: 'Not your payment' });
  if (payment.method !== 'direct_transfer') return res.status(400).json({ error: 'Proof of payment only applies to direct transfer' });
  if (payment.status !== 'pending') return res.status(400).json({ error: `Payment is already ${payment.status}` });
  if (!req.file) return res.status(400).json({ error: 'A file is required (form field name: file)' });

  const provider = getStorageProvider();
  const { fileUrl } = await provider.describeUploadedFile(req, req.file);

  const ts = now();
  await db.prepare(
    "UPDATE payments SET status = 'awaiting_confirmation', proof_url = ?, proof_uploaded_at = ?, updated_at = ? WHERE id = ?"
  ).run(fileUrl, ts, ts, id);

  const [parentUser, tutorUser] = await Promise.all([
    db.prepare('SELECT * FROM users WHERE id = ?').get(payment.parent_id),
    db.prepare('SELECT * FROM users WHERE id = ?').get(payment.tutor_id),
  ]);
  await notifyUser(tutorUser, templates.directTransferProofUploaded(parentUser.full_name));

  res.json({ payment: await db.prepare('SELECT * FROM payments WHERE id = ?').get(id) });
}

/**
 * POST /api/payments/:id/confirm  (the tutor being paid, or super_admin)
 * Marks a direct-transfer payment as received.
 */
async function confirmDirectTransfer(req, res) {
  const { id } = req.params;
  const payment = await db.prepare('SELECT * FROM payments WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.method !== 'direct_transfer') return res.status(400).json({ error: 'Only direct transfer payments need manual confirmation' });
  if (req.user.role !== 'super_admin' && payment.tutor_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the tutor being paid, or an admin, can confirm this payment' });
  }
  if (payment.status !== 'awaiting_confirmation') {
    return res.status(400).json({ error: `Payment is ${payment.status}, not awaiting confirmation` });
  }

  const ts = now();
  await markPaymentSuccessful(payment);
  await db.prepare('UPDATE payments SET confirmed_by = ?, updated_at = ? WHERE id = ?').run(req.user.id, ts, id);
  if (req.user.role === 'super_admin') await require('../services/auditLog').logAdminAction(req.user.id, 'payment.confirm_transfer', { targetType: 'payment', targetId: id });

  res.json({ payment: await db.prepare('SELECT * FROM payments WHERE id = ?').get(id) });
}

/** POST /api/payments/mock/complete  body: { reference } */
async function mockComplete(req, res) {
  const provider = getProvider();
  if (provider.name !== 'mock') return res.status(400).json({ error: 'Mock completion is only available when PAYMENT_PROVIDER=mock' });

  const { reference } = req.body || {};
  const payment = await db.prepare('SELECT * FROM payments WHERE provider_reference = ?').get(reference);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.method === 'direct_transfer') {
    return res.status(400).json({ error: 'Direct transfer payments are confirmed via POST /payments/:id/confirm, not mock completion' });
  }

  await markPaymentSuccessful(payment);
  res.json({ ok: true, payment: await db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id) });
}

async function markPaymentSuccessful(payment) {
  const ts = now();
  await db.prepare("UPDATE payments SET status = 'successful', paid_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, payment.id);

  const [parentUser, tutorUser] = await Promise.all([
    db.prepare('SELECT * FROM users WHERE id = ?').get(payment.parent_id),
    db.prepare('SELECT * FROM users WHERE id = ?').get(payment.tutor_id),
  ]);
  await Promise.all([
    notifyUser(parentUser, templates.paymentReceipt(tutorUser.full_name, payment.amount, payment.currency)),
    notifyUser(tutorUser, templates.paymentReceived(parentUser.full_name, payment.tutor_amount, payment.currency)),
  ]);
}

/** POST /api/payments/webhook */
async function webhook(req, res) {
  const provider = getProvider();
  if (provider.name === 'paystack') {
    const signature = req.headers['x-paystack-signature'];
    const valid = provider.verifyWebhookSignature(req.rawBody || JSON.stringify(req.body), signature);
    if (!valid) return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const event = req.body;
  if (event?.event === 'charge.success') {
    const reference = event.data?.reference;
    const payment = await db.prepare('SELECT * FROM payments WHERE provider_reference = ?').get(reference);
    if (payment && payment.status !== 'successful') await markPaymentSuccessful(payment);
  }

  res.status(200).json({ received: true });
}

/** GET /api/payments/mine */
async function mine(req, res) {
  let rows;
  let paging = null;
  let total = 0;
  if (req.user.role === 'parent' || req.user.role === 'adult_student') {
    rows = await db
      .prepare(
        `SELECT p.*, u.full_name AS tutor_name FROM payments p JOIN users u ON u.id = p.tutor_id
         WHERE p.parent_id = ? AND p.deleted_at IS NULL ORDER BY p.created_at DESC`
      )
      .all(req.user.id);
  } else if (req.user.role === 'tutor') {
    rows = await db
      .prepare(
        `SELECT p.*, u.full_name AS parent_name FROM payments p JOIN users u ON u.id = p.parent_id
         WHERE p.tutor_id = ? AND p.deleted_at IS NULL ORDER BY p.created_at DESC`
      )
      .all(req.user.id);
  } else if (req.user.role === 'super_admin') {
    paging = getPaging(req);
    total = (await db.prepare('SELECT COUNT(*) AS count FROM payments WHERE deleted_at IS NULL').get()).count;
    rows = await db.prepare('SELECT * FROM payments WHERE deleted_at IS NULL ORDER BY created_at DESC, id LIMIT ? OFFSET ?').all(paging.limit, paging.offset);
  } else {
    return res.status(403).json({ error: 'Not available for this role' });
  }
  res.json({ payments: rows, ...(paging ? pageMeta(paging, total) : {}) });
}

/** GET /api/payments/earnings/summary  (tutor) */
async function earningsSummary(req, res) {
  if (req.user.role !== 'tutor') return res.status(403).json({ error: 'Tutors only' });

  const totalEarned = Number((await db
    .prepare("SELECT COALESCE(SUM(tutor_amount), 0) AS total FROM payments WHERE tutor_id = ? AND status = 'successful'")
    .get(req.user.id)).total);

  const pendingPayout = Number((await db
    .prepare("SELECT COALESCE(SUM(tutor_amount), 0) AS total FROM payments WHERE tutor_id = ? AND status = 'successful' AND payout_id IS NULL")
    .get(req.user.id)).total);

  const alreadyPaidOut = totalEarned - pendingPayout;

  res.json({ total_earned: totalEarned, already_paid_out: alreadyPaidOut, pending_payout: pendingPayout });
}

/**
 * GET /api/payments/:id/transfer-details  (the parent who owns this payment)
 * Re-fetches the bank details for an existing direct-transfer payment.
 * Needed because those details are only ever returned once, inline, from
 * POST /initialize — a parent who navigates away before uploading proof
 * (very plausible: they need to actually go make the transfer first) would
 * otherwise have no way back to the account number and amount, since a
 * second initialize attempt is correctly blocked while one is pending.
 */
async function getTransferDetails(req, res) {
  const { id } = req.params;
  const payment = await db.prepare('SELECT * FROM payments WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.parent_id !== req.user.id) return res.status(403).json({ error: 'Not your payment' });
  if (payment.method !== 'direct_transfer') return res.status(400).json({ error: 'Not a direct transfer payment' });

  const bankName = await getSetting('transfer_bank_name');
  const accountNumber = await getSetting('transfer_account_number');
  const accountName = await getSetting('transfer_account_name');

  res.json({
    payment_id: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    transfer_instructions: { bank_name: bankName, account_number: accountNumber, account_name: accountName },
  });
}

module.exports = { initialize, uploadMiddleware, uploadProof, confirmDirectTransfer, getTransferDetails, mockComplete, webhook, mine, earningsSummary };
