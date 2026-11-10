const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { uuidv4, generateUniqueReferralCode } = require('../utils/referral');
const { signAccessToken, signRefreshToken } = require('../utils/jwt');

function now() {
  return new Date().toISOString();
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  return code;
}

/** POST /api/children/:id/invite  (parent only, must own this child row) */
async function createInvite(req, res) {
  const { id } = req.params;
  const child = await db.prepare('SELECT * FROM children WHERE id = ? AND parent_id = ? AND deleted_at IS NULL').get(id, req.user.id);
  if (!child) return res.status(404).json({ error: 'Child not found' });
  if (child.user_id) return res.status(400).json({ error: 'This child already has their own login' });

  await db.prepare("UPDATE child_invites SET status = 'expired', updated_at = ? WHERE child_id = ? AND status = 'pending'").run(now(), id);

  const code = generateCode();
  const inviteId = uuidv4();
  const ts = now();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db.prepare(
    `INSERT INTO child_invites (id, child_id, code, created_by_user_id, status, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).run(inviteId, id, code, req.user.id, expiresAt, ts, ts);

  res.status(201).json({ code, expires_at: expiresAt, child_name: child.full_name });
}

/**
 * POST /api/auth/child/redeem-invite
 * body: { code, username, password }
 */
async function redeemInvite(req, res) {
  const { code, username, password } = req.body || {};
  if (!code || !username || !password) return res.status(400).json({ error: 'code, username, and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'username must be 3-20 characters: letters, numbers, underscore only' });
  }

  const invite = await db.prepare("SELECT * FROM child_invites WHERE code = ? AND status = 'pending'").get(code.toUpperCase());
  if (!invite) return res.status(400).json({ error: 'Invalid or already-used code' });
  if (new Date(invite.expires_at) < new Date()) {
    await db.prepare("UPDATE child_invites SET status = 'expired', updated_at = ? WHERE id = ?").run(now(), invite.id);
    return res.status(400).json({ error: 'This code has expired — ask your parent for a new one' });
  }

  const child = await db.prepare('SELECT * FROM children WHERE id = ?').get(invite.child_id);
  if (!child || child.user_id) return res.status(400).json({ error: 'This invite is no longer valid' });

  const usernameTaken = await db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
  if (usernameTaken) return res.status(409).json({ error: 'That username is already taken — try another' });

  const txn = db.transaction(async () => {
    const userId = uuidv4();
    const ts = now();
    const passwordHash = bcrypt.hashSync(password, 10);
    const referralCode = await generateUniqueReferralCode(db);

    await db.prepare(
      `INSERT INTO users (id, role, full_name, username, password_hash, referral_code, school_id, status, created_at, updated_at)
       VALUES (?, 'child', ?, ?, ?, ?, ?, 'active', ?, ?)`
    ).run(userId, child.full_name, username.toLowerCase(), passwordHash, referralCode, child.school_id, ts, ts);

    await db.prepare('UPDATE children SET user_id = ?, updated_at = ? WHERE id = ?').run(userId, ts, child.id);
    await db.prepare("UPDATE child_invites SET status = 'used', used_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, invite.id);

    return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  });

  const user = await txn();
  const { password_hash, ...safeUser } = user;

  res.status(201).json({
    user: safeUser,
    access_token: signAccessToken(user),
    refresh_token: signRefreshToken(user),
  });
}

module.exports = { createInvite, redeemInvite };
