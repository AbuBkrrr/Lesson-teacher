const db = require('../config/db');

/** GET /api/referrals/me */
async function myReferrals(req, res) {
  const rows = await db
    .prepare(
      `SELECT r.*, u.full_name AS referred_name, u.role AS referred_role, u.created_at AS referred_signed_up_at
       FROM referrals r
       JOIN users u ON u.id = r.new_user_id
       WHERE r.marketer_user_id = ? AND r.deleted_at IS NULL
       ORDER BY r.created_at DESC`
    )
    .all(req.user.id);

  const summary = {
    total: rows.length,
    pending: rows.filter((r) => r.status === 'pending').length,
    converted: rows.filter((r) => r.status === 'converted').length,
  };

  res.json({ referral_code: await getOwnReferralCode(req.user.id), summary, referrals: rows });
}

async function getOwnReferralCode(userId) {
  const row = await db.prepare('SELECT referral_code FROM users WHERE id = ?').get(userId);
  return row ? row.referral_code : null;
}

/** GET /api/referrals/unresolved  (super_admin only) */
async function unresolved(req, res) {
  const rows = await db
    .prepare(
      `SELECT r.*, u.full_name AS referred_name
       FROM referrals r
       JOIN users u ON u.id = r.new_user_id
       WHERE r.status = 'unresolved' AND r.deleted_at IS NULL
       ORDER BY r.created_at DESC`
    )
    .all();
  res.json({ referrals: rows });
}

/** POST /api/referrals/:id/resolve  (super_admin only)  body: { marketer_user_id } */
async function resolve(req, res) {
  const { id } = req.params;
  const { marketer_user_id } = req.body || {};

  const marketer = await db.prepare('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL').get(marketer_user_id);
  if (!marketer) return res.status(400).json({ error: 'marketer_user_id does not match a known user' });

  const referral = await db.prepare('SELECT * FROM referrals WHERE id = ?').get(id);
  if (!referral) return res.status(404).json({ error: 'Referral not found' });

  const ts = new Date().toISOString();
  await db.prepare(
    `UPDATE referrals SET marketer_user_id = ?, status = 'pending', updated_at = ? WHERE id = ?`
  ).run(marketer_user_id, ts, id);

  res.json({ ok: true });
}

module.exports = { myReferrals, unresolved, resolve };
