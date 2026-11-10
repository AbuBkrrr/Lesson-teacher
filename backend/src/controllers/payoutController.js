const db = require('../config/db');
const { getPaging, pageMeta } = require('../utils/paging');
const { uuidv4 } = require('../utils/referral');
const { getProvider } = require('../services/paymentProviders');
const { getSetting } = require('../utils/settings');
const { logAdminAction } = require('../services/auditLog');

function now() {
  return new Date().toISOString();
}

const { notifyUser, templates } = require('../services/notifications');

/**
 * Reserve a tutor's unpaid earnings, then pay them out.
 * Reserving (payout row + payments.payout_id) happens in one transaction with
 * row locks, so two concurrent clicks can never pay the same earnings twice.
 * If the provider call fails, the reservation is released and the payout is
 * marked failed, so nothing is stuck and nothing is paid without a record.
 * Returns { error } (400) or { payout, gross, fee }.
 */
async function reserveAndPay({ tutorId, recipientCode, speed, initiatedBy, feePercent = 0 }) {
  const ts0 = now();
  const reserved = await db.transaction(async () => {
    const owed = await db
      .prepare("SELECT * FROM payments WHERE tutor_id = ? AND status = 'successful' AND payout_id IS NULL FOR UPDATE")
      .all(tutorId);
    if (owed.length === 0) return null;
    const gross = owed.reduce((sum, p) => sum + Number(p.tutor_amount), 0);
    const fee = Math.round(gross * (feePercent / 100) * 100) / 100;
    const net = Math.round((gross - fee) * 100) / 100;
    const payoutId = uuidv4();
    await db.prepare(
      `INSERT INTO payouts (id, tutor_id, amount, currency, status, provider, initiated_by_user_id, speed, instant_fee, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
    ).run(payoutId, tutorId, net, owed[0].currency, getProvider().name, initiatedBy, speed, fee, ts0, ts0);
    for (const p of owed) {
      await db.prepare('UPDATE payments SET payout_id = ?, updated_at = ? WHERE id = ?').run(payoutId, ts0, p.id);
    }
    return { payoutId, gross, fee, net, currency: owed[0].currency, count: owed.length };
  })();
  if (!reserved) return { error: 'Nothing owed right now' };

  let transfer;
  try {
    transfer = await getProvider().initiateTransfer({
      recipient_code: recipientCode,
      amount: reserved.net,
      currency: reserved.currency,
      reason: `Lesson Teacher ${speed === 'instant' ? 'instant ' : ''}payout — ${reserved.count} session(s)${reserved.fee ? `, ${feePercent}% fee applied` : ''}`,
    });
  } catch (err) {
    await db.transaction(async () => {
      await db.prepare('UPDATE payments SET payout_id = NULL, updated_at = ? WHERE payout_id = ?').run(now(), reserved.payoutId);
      await db.prepare("UPDATE payouts SET status = 'failed', updated_at = ? WHERE id = ?").run(now(), reserved.payoutId);
    })();
    throw err;
  }

  const ts = now();
  const status = transfer.status === 'success' ? 'paid' : 'processing';
  await db.prepare('UPDATE payouts SET status = ?, provider_reference = ?, paid_at = ?, updated_at = ? WHERE id = ?')
    .run(status, transfer.transfer_reference, status === 'paid' ? ts : null, ts, reserved.payoutId);
  const payout = await db.prepare('SELECT * FROM payouts WHERE id = ?').get(reserved.payoutId);
  const tutor = await db.prepare('SELECT * FROM users WHERE id = ?').get(tutorId);
  if (tutor) await notifyUser(tutor, templates.payoutSent(reserved.net, reserved.currency, status));
  return { payout, gross: reserved.gross, fee: reserved.fee };
}

/** GET /api/admin/payouts/balances */
async function balances(req, res) {
  const rows = await db
    .prepare(
      `SELECT u.id AS tutor_id, u.full_name, tp.currency,
              COALESCE(SUM(p.tutor_amount), 0) AS owed
       FROM users u
       JOIN tutor_profiles tp ON tp.user_id = u.id
       LEFT JOIN payments p ON p.tutor_id = u.id AND p.status = 'successful' AND p.payout_id IS NULL
       WHERE u.role = 'tutor' AND u.deleted_at IS NULL
       GROUP BY u.id, u.full_name, tp.currency
       HAVING COALESCE(SUM(p.tutor_amount), 0) > 0
       ORDER BY owed DESC`
    )
    .all();
  res.json({ balances: rows.map((r) => ({ ...r, owed: Number(r.owed) })) });
}

/** POST /api/admin/payouts/tutor/:tutorId */
async function payoutTutor(req, res) {
  const { tutorId } = req.params;

  const tutor = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'tutor' AND deleted_at IS NULL").get(tutorId);
  if (!tutor) return res.status(404).json({ error: 'Tutor not found' });

  const tutorProfile = await db.prepare('SELECT * FROM tutor_profiles WHERE user_id = ?').get(tutorId);
  if (!tutorProfile?.payout_recipient_code) {
    return res.status(400).json({ error: 'This tutor has not set up their payout bank account yet' });
  }

  const r = await reserveAndPay({ tutorId, recipientCode: tutorProfile.payout_recipient_code, speed: 'standard', initiatedBy: req.user.id });
  if (r.error) return res.status(400).json({ error: 'Nothing owed to this tutor right now' });
  const payoutId = r.payout.id;

  await logAdminAction(req.user.id, 'payout.create', { targetType: 'payout', targetId: payoutId, details: { tutor_id: req.params.tutorId } });
  res.status(201).json({ payout: r.payout });
}

/** GET /api/admin/payouts */
async function listAll(req, res) {
  const p = getPaging(req);
  const total = (await db.prepare('SELECT COUNT(*) AS count FROM payouts WHERE deleted_at IS NULL').get()).count;
  const rows = await db
    .prepare(
      `SELECT po.*, u.full_name AS tutor_name FROM payouts po JOIN users u ON u.id = po.tutor_id
       WHERE po.deleted_at IS NULL ORDER BY po.created_at DESC, po.id LIMIT ? OFFSET ?`
    )
    .all(p.limit, p.offset);
  res.json({ payouts: rows, ...pageMeta(p, total) });
}

/**
 * POST /api/payouts/instant  (tutor)
 * Self-serve: the tutor cashes out their own already-earned, not-yet-
 * paid-out balance right away instead of waiting for the next admin
 * payout batch, for a small fee (instant_payout_fee_percent).
 */
async function requestInstantPayout(req, res) {
  if (req.user.role !== 'tutor') return res.status(403).json({ error: 'Tutors only' });

  const tutorProfile = await db.prepare('SELECT * FROM tutor_profiles WHERE user_id = ?').get(req.user.id);
  if (!tutorProfile?.payout_recipient_code) {
    return res.status(400).json({ error: 'Set up your payout bank account first' });
  }

  const feePercent = Number(await getSetting('instant_payout_fee_percent'));
  const r = await reserveAndPay({ tutorId: req.user.id, recipientCode: tutorProfile.payout_recipient_code, speed: 'instant', initiatedBy: req.user.id, feePercent });
  if (r.error) return res.status(400).json({ error: 'Nothing owed to you right now' });
  res.status(201).json({ payout: r.payout, gross_amount: r.gross, fee: r.fee });
}

/** GET /api/payouts/mine */
async function mine(req, res) {
  if (req.user.role !== 'tutor') return res.status(403).json({ error: 'Tutors only' });
  const rows = await db
    .prepare("SELECT * FROM payouts WHERE tutor_id = ? AND deleted_at IS NULL ORDER BY created_at DESC")
    .all(req.user.id);
  res.json({ payouts: rows });
}

module.exports = { balances, payoutTutor, listAll, mine, requestInstantPayout };
