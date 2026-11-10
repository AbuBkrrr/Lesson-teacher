const db = require('../config/db');
const { getPaging, pageMeta } = require('../utils/paging');
const { logAdminAction } = require('../services/auditLog');
const { notifyUser } = require('../services/notifications');
const { issueEmailVerification, issuePasswordReset } = require('./authController');

function likeOf(q) {
  return `%${String(q).trim().toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}

/** GET /api/admin/bookings?status=&q=&page= — every booking, with names and payment state. */
async function listBookings(req, res) {
  const { status, q } = req.query;
  let where = ' WHERE b.deleted_at IS NULL';
  const params = [];
  if (status) { where += ' AND b.status = ?'; params.push(status); }
  if (q && String(q).trim()) {
    where += " AND (LOWER(pu.full_name) LIKE ? ESCAPE '\\' OR LOWER(tu.full_name) LIKE ? ESCAPE '\\' OR LOWER(b.subject) LIKE ? ESCAPE '\\')";
    const l = likeOf(q); params.push(l, l, l);
  }
  const from = ` FROM bookings b JOIN users pu ON pu.id = b.parent_id JOIN users tu ON tu.id = b.tutor_id${where}`;
  const p = getPaging(req, { defaultSize: 25, maxSize: 100 });
  const total = (await db.prepare(`SELECT COUNT(*) AS count${from}`).get(...params)).count;
  const bookings = await db.prepare(
    `SELECT b.id, b.subject, b.scheduled_at, b.status, b.created_at, b.child_id,
            pu.full_name AS parent_name, tu.full_name AS tutor_name,
            (SELECT status FROM payments p WHERE p.booking_id = b.id AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 1) AS payment_status,
            (SELECT amount FROM payments p WHERE p.booking_id = b.id AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 1) AS payment_amount,
            (SELECT currency FROM payments p WHERE p.booking_id = b.id AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 1) AS currency
     ${from} ORDER BY b.created_at DESC, b.id LIMIT ? OFFSET ?`
  ).all(...params, p.limit, p.offset);
  res.json({ bookings, ...pageMeta(p, total) });
}

/** GET /api/admin/payments?status=&method=&page= — includes proof links for bank transfers. */
async function listPayments(req, res) {
  const { status, method } = req.query;
  let where = ' WHERE p.deleted_at IS NULL';
  const params = [];
  if (status) { where += ' AND p.status = ?'; params.push(status); }
  if (method) { where += ' AND p.method = ?'; params.push(method); }
  const from = ` FROM payments p JOIN users pu ON pu.id = p.parent_id JOIN users tu ON tu.id = p.tutor_id JOIN bookings b ON b.id = p.booking_id${where}`;
  const p = getPaging(req, { defaultSize: 25, maxSize: 100 });
  const total = (await db.prepare(`SELECT COUNT(*) AS count${from}`).get(...params)).count;
  const payments = await db.prepare(
    `SELECT p.id, p.booking_id, p.amount, p.currency, p.platform_fee, p.tutor_amount, p.status, p.method, p.proof_url,
            p.proof_uploaded_at, p.paid_at, p.created_at, p.payout_id,
            pu.full_name AS parent_name, tu.full_name AS tutor_name, b.subject
     ${from} ORDER BY (p.status = 'awaiting_confirmation') DESC, p.created_at DESC, p.id LIMIT ? OFFSET ?`
  ).all(...params, p.limit, p.offset);
  res.json({ payments, ...pageMeta(p, total) });
}

/** GET /api/admin/tutors?q=&platform_verified=&page= */
async function listTutors(req, res) {
  const { q, platform_verified } = req.query;
  let where = " WHERE u.role = 'tutor' AND u.deleted_at IS NULL";
  const params = [];
  if (q && String(q).trim()) {
    where += " AND (LOWER(u.full_name) LIKE ? ESCAPE '\\' OR LOWER(u.email) LIKE ? ESCAPE '\\')";
    const l = likeOf(q); params.push(l, l);
  }
  if (platform_verified === 'true') where += ' AND tp.platform_verified = 1';
  if (platform_verified === 'false') where += ' AND (tp.platform_verified IS NULL OR tp.platform_verified = 0)';
  const from = ` FROM users u JOIN tutor_profiles tp ON tp.user_id = u.id${where}`;
  const p = getPaging(req, { defaultSize: 25, maxSize: 100 });
  const total = (await db.prepare(`SELECT COUNT(*) AS count${from}`).get(...params)).count;
  const tutors = await db.prepare(
    `SELECT u.id AS user_id, u.full_name, u.email, u.status, u.id_verification_status,
            tp.platform_verified, tp.rating, tp.review_count, tp.hourly_rate
     ${from} ORDER BY tp.platform_verified DESC NULLS LAST, u.created_at DESC, u.id LIMIT ? OFFSET ?`
  ).all(...params, p.limit, p.offset);
  res.json({ tutors, ...pageMeta(p, total) });
}

/** GET /api/admin/refunds?status=&page= — queue with names and amounts. */
async function listRefunds(req, res) {
  const { status } = req.query;
  let where = ' WHERE 1=1';
  const params = [];
  if (status) { where += ' AND r.status = ?'; params.push(status); }
  const from = ` FROM refund_requests r JOIN users u ON u.id = r.requested_by JOIN payments p ON p.id = r.payment_id JOIN bookings b ON b.id = r.booking_id JOIN users tu ON tu.id = p.tutor_id${where}`;
  const pg = getPaging(req, { defaultSize: 25, maxSize: 100 });
  const total = (await db.prepare(`SELECT COUNT(*) AS count${from}`).get(...params)).count;
  const refunds = await db.prepare(
    `SELECT r.id, r.reason, r.resolution, r.status, r.resolution_note, r.created_at, r.resolved_at,
            u.full_name AS requester_name, tu.full_name AS tutor_name, b.subject,
            p.amount, p.currency, p.status AS payment_status, p.payout_id
     ${from} ORDER BY (r.status = 'pending') DESC, r.created_at DESC, r.id LIMIT ? OFFSET ?`
  ).all(...params, pg.limit, pg.offset);
  res.json({ refunds, ...pageMeta(pg, total) });
}

/**
 * POST /api/admin/announcements  body: { audience: 'all'|role, subject, body }
 * Sends to every active, non-deleted user in the audience (in-app + email/SMS/push).
 */
async function announce(req, res) {
  const { audience = 'all', subject, body } = req.body || {};
  const roles = ['all', 'parent', 'adult_student', 'tutor', 'child', 'school_admin'];
  if (!roles.includes(audience)) return res.status(400).json({ error: `audience must be one of: ${roles.join(', ')}` });
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 120) return res.status(400).json({ error: 'subject is required (max 120 characters)' });
  if (typeof body !== 'string' || !body.trim() || body.length > 2000) return res.status(400).json({ error: 'body is required (max 2000 characters)' });

  const users = audience === 'all'
    ? await db.prepare("SELECT * FROM users WHERE deleted_at IS NULL AND status <> 'suspended' AND role <> 'super_admin'").all()
    : await db.prepare("SELECT * FROM users WHERE deleted_at IS NULL AND status <> 'suspended' AND role = ?").all(audience);

  let sent = 0;
  for (let i = 0; i < users.length; i += 20) {
    await Promise.all(users.slice(i, i + 20).map(async (u) => {
      try { await notifyUser(u, { type: 'announcement', subject: subject.trim(), body: body.trim() }); sent += 1; } catch (e) { console.error('[announce]', e.message); }
    }));
  }
  await logAdminAction(req.user.id, 'announcement.send', { details: { audience, subject: subject.trim(), recipients: sent } });
  res.status(201).json({ ok: true, recipients: sent });
}

async function activeTarget(id) {
  return db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
}

/** POST /api/admin/users/:id/resend-verification */
async function resendVerification(req, res) {
  const u = await activeTarget(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (!u.email) return res.status(400).json({ error: 'This user has no email address' });
  if (u.email_verified_at) return res.status(400).json({ error: 'Email is already verified' });
  await issueEmailVerification(u);
  await logAdminAction(req.user.id, 'user.resend_verification', { targetType: 'user', targetId: u.id });
  res.json({ ok: true });
}

/** POST /api/admin/users/:id/password-reset — emails the user a reset link (admins never see or set passwords). */
async function sendPasswordReset(req, res) {
  const u = await activeTarget(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (!u.email && !u.phone) return res.status(400).json({ error: 'This user has no email or phone to send the link to' });
  await issuePasswordReset(u);
  await logAdminAction(req.user.id, 'user.password_reset_sent', { targetType: 'user', targetId: u.id });
  res.json({ ok: true });
}

module.exports = { listBookings, listPayments, listTutors, listRefunds, announce, resendVerification, sendPasswordReset };
