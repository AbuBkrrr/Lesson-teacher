const db = require('../config/db');
const { getSetting, setSetting } = require('../utils/settings');
const { logAdminAction } = require('../services/auditLog');
const { signAccessToken } = require('../utils/jwt');
const { getPaging, pageMeta } = require('../utils/paging');
const { forgetUserStatus } = require('../middleware/auth');

function now() {
  return new Date().toISOString();
}

/** GET /api/admin/stats */
async function stats(req, res) {
  const usersByRole = await db
    .prepare("SELECT role, COUNT(*) AS count FROM users WHERE deleted_at IS NULL GROUP BY role")
    .all();
  const totalSchools = Number((await db.prepare("SELECT COUNT(*) AS count FROM schools WHERE deleted_at IS NULL").get()).count);
  const totalBookings = Number((await db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE deleted_at IS NULL").get()).count);
  const referralStats = (await db
    .prepare("SELECT status, COUNT(*) AS count FROM referrals WHERE deleted_at IS NULL GROUP BY status")
    .all()).map((r) => ({ ...r, count: Number(r.count) }));

  const one = async (sql) => Number((await db.prepare(sql).get()).count);
  // The admin's to-do list: things that stall real users until someone acts.
  const attention = {
    id_verifications: await one("SELECT COUNT(*) AS count FROM users WHERE id_verification_status = 'pending' AND id_document_url IS NOT NULL AND deleted_at IS NULL"),
    refund_requests: await one("SELECT COUNT(*) AS count FROM refund_requests WHERE status IN ('pending','approved')"),
    transfers_to_confirm: await one("SELECT COUNT(*) AS count FROM payments WHERE status = 'awaiting_confirmation' AND deleted_at IS NULL"),
    tutors_owed: await one("SELECT COUNT(DISTINCT tutor_id) AS count FROM payments WHERE status = 'successful' AND payout_id IS NULL AND deleted_at IS NULL"),
    unresolved_referrals: await one("SELECT COUNT(*) AS count FROM referrals WHERE status = 'unresolved' AND deleted_at IS NULL"),
  };
  const money = await db.prepare("SELECT currency, SUM(amount) AS gross, SUM(platform_fee) AS fees FROM payments WHERE status = 'successful' AND deleted_at IS NULL GROUP BY currency").all();

  res.json({
    attention,
    revenue: money.map((m) => ({ currency: m.currency, gross: Number(m.gross), platform_fees: Number(m.fees) })),
    users_by_role: usersByRole.map((r) => ({ ...r, count: Number(r.count) })),
    total_schools: totalSchools,
    total_bookings: totalBookings,
    referrals_by_status: referralStats,
  });
}

/** GET /api/admin/users?role=&school_id=&status= */
async function listUsers(req, res) {
  const { role, school_id, status, q } = req.query;
  let where = ' WHERE deleted_at IS NULL';
  const params = [];

  if (q && String(q).trim()) {
    const like = `%${String(q).trim().toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    where += " AND (LOWER(full_name) LIKE ? ESCAPE '\\' OR LOWER(email) LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR LOWER(referral_code) LIKE ? ESCAPE '\\')";
    params.push(like, like, like, like);
  }

  if (role) { where += ' AND role = ?'; params.push(role); }
  if (school_id) { where += ' AND school_id = ?'; params.push(school_id); }
  if (status) { where += ' AND status = ?'; params.push(status); }

  const p = getPaging(req);
  const total = (await db.prepare(`SELECT COUNT(*) AS count FROM users${where}`).get(...params)).count;
  const users = await db
    .prepare(`SELECT id, role, full_name, email, phone, referral_code, school_id, status, created_at FROM users${where} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`)
    .all(...params, p.limit, p.offset);
  res.json({ users, ...pageMeta(p, total) });
}

/** GET /api/admin/schools */
async function listSchools(req, res) {
  const rows = await db.prepare('SELECT * FROM schools WHERE deleted_at IS NULL ORDER BY created_at DESC').all();
  res.json({ schools: rows });
}

/** POST /api/admin/users/:id/suspend */
async function suspendUser(req, res) {
  const { id } = req.params;
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot suspend your own account' });
  const target = await db.prepare('SELECT role FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
  if (target && target.role === 'super_admin') return res.status(400).json({ error: 'Another admin account cannot be suspended here' });
  const result = await db.prepare("UPDATE users SET status = 'suspended', updated_at = ? WHERE id = ?").run(now(), id);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  // Kill every session now: refresh tokens revoked, cached status dropped.
  await db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(id);
  forgetUserStatus(id);
  await logAdminAction(req.user.id, 'user.suspend', { targetType: 'user', targetId: id });
  res.json({ ok: true });
}

/** POST /api/admin/users/:id/reactivate */
async function reactivateUser(req, res) {
  const { id } = req.params;
  const result = await db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?").run(now(), id);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  forgetUserStatus(id);
  await logAdminAction(req.user.id, 'user.reactivate', { targetType: 'user', targetId: id });
  res.json({ ok: true });
}

async function settingsPayload() {
  return {
    commission_percent: Number(await getSetting('commission_percent')),
    transfer_bank_name: await getSetting('transfer_bank_name'),
    transfer_account_number: await getSetting('transfer_account_number'),
    transfer_account_name: await getSetting('transfer_account_name'),
    sibling_discount_percent: Number(await getSetting('sibling_discount_percent')),
    satisfaction_guarantee_hours: Number(await getSetting('satisfaction_guarantee_hours')),
    instant_payout_fee_percent: Number(await getSetting('instant_payout_fee_percent')),
  };
}

/** GET /api/admin/settings */
async function getSettings(req, res) {
  res.json(await settingsPayload());
}

/**
 * PATCH /api/admin/settings
 * body: { commission_percent?, transfer_bank_name?, transfer_account_number?, transfer_account_name?,
 *          sibling_discount_percent?, satisfaction_guarantee_hours?, instant_payout_fee_percent? }
 * All fields are optional — only the ones provided are updated.
 */
async function updateSettings(req, res) {
  const {
    commission_percent, transfer_bank_name, transfer_account_number, transfer_account_name,
    sibling_discount_percent, satisfaction_guarantee_hours, instant_payout_fee_percent,
  } = req.body || {};

  const isNum = (v) => typeof v === 'number' ? Number.isFinite(v) : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
  const pctFields = { commission_percent, sibling_discount_percent, instant_payout_fee_percent };
  for (const [key, value] of Object.entries(pctFields)) {
    if (value !== undefined && (!isNum(value) || Number(value) < 0 || Number(value) > 100)) {
      return res.status(400).json({ error: `${key} must be a number between 0 and 100` });
    }
  }
  if (satisfaction_guarantee_hours !== undefined && (!isNum(satisfaction_guarantee_hours) || Number(satisfaction_guarantee_hours) < 0 || Number(satisfaction_guarantee_hours) > 8760)) {
    return res.status(400).json({ error: 'satisfaction_guarantee_hours must be a number between 0 and 8760' });
  }
  for (const [key, value] of Object.entries(pctFields)) {
    if (value !== undefined) await setSetting(key, Number(value));
  }
  if (satisfaction_guarantee_hours !== undefined) await setSetting('satisfaction_guarantee_hours', Number(satisfaction_guarantee_hours));
  if (transfer_bank_name !== undefined) await setSetting('transfer_bank_name', transfer_bank_name);
  if (transfer_account_number !== undefined) await setSetting('transfer_account_number', transfer_account_number);
  if (transfer_account_name !== undefined) await setSetting('transfer_account_name', transfer_account_name);

  // Log which fields changed — never the values of bank-account fields,
  // which don't belong in a log that other admins can read.
  const sensitive = new Set(['transfer_account_number']);
  const changed = Object.keys(req.body || {}).filter((k) => req.body[k] !== undefined);
  await logAdminAction(req.user.id, 'settings.update', {
    targetType: 'settings',
    details: { fields: changed, values: Object.fromEntries(changed.filter((k) => !sensitive.has(k)).map((k) => [k, req.body[k]])) },
  });

  res.json(await settingsPayload());
}

/** GET /api/admin/audit-log?page=&page_size= */
async function auditLog(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size, 10) || 50));
  const total = Number((await db.prepare('SELECT COUNT(*) AS count FROM admin_audit_log').get()).count);
  const rows = await db.prepare(
    `SELECT l.*, u.full_name AS admin_name FROM admin_audit_log l JOIN users u ON u.id = l.admin_id
     ORDER BY l.created_at DESC LIMIT ? OFFSET ?`
  ).all(pageSize, (page - 1) * pageSize);
  res.json({
    entries: rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })),
    page, page_size: pageSize, total,
  });
}

/**
 * POST /api/admin/users/:id/impersonate
 * Issues a short-lived access token (no refresh token, so it can't be
 * extended) for the target user, for support/debugging. Every use is
 * audit-logged. Another super_admin can't be impersonated, and neither
 * can a suspended or deleted account.
 */
async function impersonate(req, res) {
  const target = await db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'super_admin') return res.status(403).json({ error: 'Cannot impersonate another super admin' });
  if (target.status === 'suspended') return res.status(403).json({ error: 'Cannot impersonate a suspended account' });

  await logAdminAction(req.user.id, 'user.impersonate', { targetType: 'user', targetId: target.id });
  res.json({
    access_token: signAccessToken(target),
    user: { id: target.id, role: target.role, full_name: target.full_name },
  });
}

module.exports = { stats, listUsers, listSchools, suspendUser, reactivateUser, getSettings, updateSettings, auditLog, impersonate };
