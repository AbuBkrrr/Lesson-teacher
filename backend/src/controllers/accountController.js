const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { sanitizeUser } = require('./authController');

function now() {
  return new Date().toISOString();
}

/**
 * GET /api/account/export — a self-service data export (the kind data
 * protection law generally requires offering). Scoped to what this user's
 * own account produced or received across the app's core tables, not
 * every row that merely references them (e.g. a tutor's own messages are
 * included, but not a parent's monitoring view of a child's thread).
 */
async function exportData(req, res) {
  const userId = req.user.id;
  const role = req.user.role;

  const profile = sanitizeUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(userId));

  const [bookingsAsParent, bookingsAsTutor] = await Promise.all([
    db.prepare('SELECT * FROM bookings WHERE parent_id = ? ORDER BY created_at DESC').all(userId),
    db.prepare('SELECT * FROM bookings WHERE tutor_id = ? ORDER BY created_at DESC').all(userId),
  ]);

  const [paymentsMade, paymentsReceived, payouts, reviewsGiven, reviewsReceived, messagesSent, notifications] = await Promise.all([
    db.prepare('SELECT * FROM payments WHERE parent_id = ? ORDER BY created_at DESC').all(userId),
    db.prepare('SELECT * FROM payments WHERE tutor_id = ? ORDER BY created_at DESC').all(userId),
    db.prepare('SELECT * FROM payouts WHERE tutor_id = ? ORDER BY created_at DESC').all(userId),
    db.prepare('SELECT * FROM reviews WHERE parent_id = ? ORDER BY created_at DESC').all(userId),
    db.prepare('SELECT * FROM reviews WHERE tutor_id = ? ORDER BY created_at DESC').all(userId),
    db.prepare('SELECT * FROM messages WHERE sender_id = ? ORDER BY created_at DESC').all(userId),
    db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC').all(userId),
  ]);

  let tutorProfile = null;
  if (role === 'tutor') {
    tutorProfile = await db.prepare('SELECT * FROM tutor_profiles WHERE user_id = ?').get(userId);
  }

  let children = null;
  if (role === 'parent') {
    children = await db.prepare('SELECT * FROM children WHERE parent_id = ?').all(userId);
  }

  res.json({
    exported_at: now(),
    profile,
    tutor_profile: tutorProfile,
    children,
    bookings: { as_parent: bookingsAsParent, as_tutor: bookingsAsTutor },
    payments: { made: paymentsMade, received: paymentsReceived },
    payouts,
    reviews: { given: reviewsGiven, received: reviewsReceived },
    messages_sent: messagesSent,
    notifications,
  });
}

/**
 * POST /api/account/delete  body: { password }
 * Soft-deletes the account (sets deleted_at, matching the pattern every
 * other table in this app already uses), after confirming the password —
 * not the access token alone, same as a bank requiring a password re-entry
 * for anything irreversible, since a stolen/left-open session shouldn't be
 * enough to destroy an account. Clears email/phone/username so they're
 * free for reuse and this user's PII footprint shrinks, but leaves
 * historical rows (bookings, payments, reviews) intact for the other
 * party's own records — those aren't this user's to erase unilaterally.
 */
async function deleteAccount(req, res) {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'password is required to confirm account deletion' });

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const ts = now();
  await db.prepare(
    `UPDATE users SET deleted_at = ?, updated_at = ?, email = NULL, phone = NULL, username = NULL WHERE id = ?`
  ).run(ts, ts, user.id);
  await db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(user.id);

  res.json({ ok: true });
}

module.exports = { exportData, deleteAccount };
