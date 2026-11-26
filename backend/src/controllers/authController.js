const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db');
const { notifyUser, templates } = require('../services/notifications');
const {
  uuidv4,
  generateUniqueReferralCode,
  resolveMarketer,
  generateUniqueJoinCode,
} = require('../utils/referral');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  REFRESH_TTL_DAYS,
} = require('../utils/jwt');

const SELF_SIGNUP_ROLES = ['parent', 'tutor', 'school_admin', 'adult_student'];
const MIN_ADULT_STUDENT_AGE = 18;
const EMAIL_VERIFICATION_TTL_HOURS = 24;

function now() {
  return new Date().toISOString();
}

/** Birthday-adjusted age in whole years as of today. */
function age(dateOfBirth) {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let years = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) years--;
  return years;
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}

/**
 * POST /api/auth/signup
 */
async function signup(req, res) {
  const {
    role,
    full_name,
    phone,
    password,
    referral_contact,
    school_name,
    school_address,
    school_join_code,
    date_of_birth,
  } = req.body || {};
  const body = req.body || {};
  // Emails are case-insensitive: store lowercase so login/reset/duplicate checks agree.
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : undefined;
  if (body.email != null && body.email !== '' && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if ([full_name, password, phone].some((v) => v != null && typeof v !== 'string')) {
    return res.status(400).json({ error: 'full_name, phone and password must be text' });
  }

  if (!role || !SELF_SIGNUP_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${SELF_SIGNUP_ROLES.join(', ')}` });
  }
  if (!full_name || !password || (!email && !phone)) {
    return res.status(400).json({ error: 'full_name, password, and at least one of email/phone are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  if (role === 'school_admin' && !school_name) {
    return res.status(400).json({ error: 'school_name is required when signing up as school_admin' });
  }
  if (role === 'adult_student') {
    if (!date_of_birth || Number.isNaN(new Date(date_of_birth).getTime())) {
      return res.status(400).json({ error: 'A valid date_of_birth is required to sign up as an adult student' });
    }
    if (age(date_of_birth) < MIN_ADULT_STUDENT_AGE) {
      return res.status(400).json({ error: `You must be at least ${MIN_ADULT_STUDENT_AGE} to sign up as an adult student` });
    }
  }

  const txn = db.transaction(async () => {
    let schoolId = null;

    if (role === 'school_admin') {
      schoolId = uuidv4();
      const joinCode = await generateUniqueJoinCode(db);
      await db.prepare(
        `INSERT INTO schools (id, name, address, contact_email, contact_phone, status, join_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`
      ).run(schoolId, school_name, school_address || null, email || null, phone || null, joinCode, now(), now());
    } else if (school_join_code) {
      const school = await db.prepare('SELECT id FROM schools WHERE join_code = ? AND deleted_at IS NULL').get(school_join_code);
      if (!school) {
        const e = new Error('Invalid school_join_code');
        e.status = 400;
        throw e;
      }
      schoolId = school.id;
    }

    const userId = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);
    const referralCode = await generateUniqueReferralCode(db);
    const marketer = await resolveMarketer(db, referral_contact);

    await db.prepare(
      `INSERT INTO users (
         id, role, full_name, email, phone, password_hash,
         referral_code, referred_by_code, referred_by_user_id,
         school_id, date_of_birth, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    ).run(
      userId, role, full_name, email || null, phone || null, passwordHash,
      referralCode, referral_contact || null, marketer ? marketer.id : null,
      schoolId, role === 'adult_student' ? date_of_birth : null, now(), now()
    );

    if (role === 'school_admin') {
      await db.prepare('UPDATE schools SET admin_user_id = ?, updated_at = ? WHERE id = ?').run(userId, now(), schoolId);
    }

    if (role === 'tutor') {
      await db.prepare(
        `INSERT INTO tutor_profiles (id, user_id, subjects, hourly_rate, currency, created_at, updated_at)
         VALUES (?, ?, '[]', NULL, 'NGN', ?, ?)`
      ).run(uuidv4(), userId, now(), now());
    }

    if (referral_contact && referral_contact.trim()) {
      await db.prepare(
        `INSERT INTO referrals (id, new_user_id, marketer_identifier, marketer_user_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        uuidv4(), userId, referral_contact.trim(), marketer ? marketer.id : null,
        marketer ? 'pending' : 'unresolved', now(), now()
      );
    }

    return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  });

  const user = await txn();

  // Credit the account to the marketing link / device it came from (best effort).
  try {
    await require('./marketingController').recordSignupAttribution(user, body.attribution);
  } catch (err) {
    console.error('[marketing] signup attribution failed', err.message);
  }

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  await storeRefreshToken(user.id, refreshToken);
  await issueEmailVerification(user);

  res.status(201).json({
    user: sanitizeUser(user),
    referral_code: user.referral_code,
    access_token: accessToken,
    refresh_token: refreshToken,
  });
}

/**
 * Issues a fresh email-verification token for a user and sends it — used
 * both right after signup and whenever the user asks to resend it. Not
 * awaited-for-failure at the call site: a send failure shouldn't block
 * signup, so callers that care (resend) check notifyUser's own per-channel
 * `status` via the notifications table if needed, but normally just fire it.
 */
async function issueEmailVerification(user) {
  if (!user.email) return;
  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000).toISOString();
  await db.prepare(
    `INSERT INTO email_verifications (id, user_id, token_hash, expires_at, used, created_at) VALUES (?, ?, ?, ?, 0, ?)`
  ).run(uuidv4(), user.id, hashToken(rawToken), expiresAt, now());
  await notifyUser(user, templates.verifyEmail(rawToken));
}

function deviceLabelFrom(req, explicit) {
  const raw = typeof explicit === 'string' && explicit.trim() ? explicit : (req?.get?.('user-agent') || 'Unknown device');
  return raw.trim().slice(0, 80);
}

async function storeRefreshToken(userId, refreshToken, label = null) {
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at, device_label, last_used_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
  ).run(uuidv4(), userId, hashToken(refreshToken), expiresAt, now(), label, now());
}

/** POST /api/auth/login */
async function login(req, res) {
  const { identifier: rawIdent, password } = req.body || {};
  const identifier = typeof rawIdent === 'string' ? rawIdent : '';
  const ident = identifier.trim();
  if (!identifier || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'identifier and password are required' });
  }

  const user = await db
    .prepare('SELECT * FROM users WHERE (LOWER(email) = ? OR phone = ? OR username = ?) AND deleted_at IS NULL')
    .get(ident.toLowerCase(), ident, ident.toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'This account has been suspended' });
  }

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  await storeRefreshToken(user.id, refreshToken, deviceLabelFrom(req, req.body?.device_label));

  res.json({
    user: sanitizeUser(user),
    access_token: accessToken,
    refresh_token: refreshToken,
  });
}

/** POST /api/auth/refresh */
async function refresh(req, res) {
  const { refresh_token } = req.body || {};
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token is required' });

  let payload;
  try {
    payload = verifyRefreshToken(refresh_token);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  const tokenRow = await db
    .prepare('SELECT * FROM refresh_tokens WHERE user_id = ? AND token_hash = ? AND revoked = 0')
    .get(payload.sub, hashToken(refresh_token));

  if (!tokenRow || new Date(tokenRow.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Refresh token not recognized or expired' });
  }

  const user = await db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(payload.sub);
  if (!user) return res.status(401).json({ error: 'User no longer exists' });
  if (user.status === 'suspended') return res.status(403).json({ error: 'This account has been suspended' });

  await db.prepare('UPDATE refresh_tokens SET last_used_at = ? WHERE id = ?').run(now(), tokenRow.id);
  const accessToken = signAccessToken(user);
  res.json({ access_token: accessToken });
}

/** POST /api/auth/logout */
async function logout(req, res) {
  const { refresh_token } = req.body || {};
  if (refresh_token) {
    await db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?').run(hashToken(refresh_token));
  }
  res.json({ ok: true });
}

const RESET_TOKEN_TTL_MINUTES = 60;

/**
 * POST /api/auth/forgot-password  body: { identifier }
 * Always responds 200 with the same generic message, whether or not the
 * identifier matched an account — a different response would let an
 * attacker enumerate which emails/phones/usernames have accounts here.
 */
async function forgotPassword(req, res) {
  const rawIdent = (req.body || {}).identifier;
  const identifier = typeof rawIdent === 'string' ? rawIdent : '';
  const ident = identifier.trim();
  const generic = { ok: true, message: 'If an account matches, reset instructions have been sent.' };
  if (!identifier) return res.json(generic);

  const user = await db
    .prepare('SELECT * FROM users WHERE (LOWER(email) = ? OR phone = ? OR username = ?) AND deleted_at IS NULL')
    .get(ident.toLowerCase(), ident, ident.toLowerCase());
  if (!user) return res.json(generic);

  await issuePasswordReset(user);

  res.json(generic);
}

async function issuePasswordReset(user) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
  await db.prepare(
    `INSERT INTO password_resets (id, user_id, token_hash, expires_at, used, created_at) VALUES (?, ?, ?, ?, 0, ?)`
  ).run(uuidv4(), user.id, hashToken(rawToken), expiresAt, now());
  await notifyUser(user, templates.passwordReset(rawToken));
}

/** POST /api/auth/reset-password  body: { token, new_password } */
async function resetPassword(req, res) {
  const { token, new_password } = req.body || {};
  if (!token || !new_password) return res.status(400).json({ error: 'token and new_password are required' });
  if (new_password.length < 8) return res.status(400).json({ error: 'new_password must be at least 8 characters' });

  const tokenHash = hashToken(token);
  const resetRow = await db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0').get(tokenHash);
  if (!resetRow || new Date(resetRow.expires_at) < new Date()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired' });
  }

  const passwordHash = bcrypt.hashSync(new_password, 10);
  await db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now(), resetRow.user_id);
  await db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(resetRow.id);
  // Resetting a password is a signal the account may have been compromised
  // (or the old password was simply forgotten and shouldn't still work
  // anywhere) — revoke every other active session.
  await db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(resetRow.user_id);

  res.json({ ok: true });
}

/** POST /api/auth/verify-email  body: { token } */
async function verifyEmail(req, res) {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token is required' });

  const tokenHash = hashToken(token);
  const row = await db.prepare('SELECT * FROM email_verifications WHERE token_hash = ? AND used = 0').get(tokenHash);
  if (!row || new Date(row.expires_at) < new Date()) {
    return res.status(400).json({ error: 'This verification link is invalid or has expired' });
  }

  await db.prepare('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), row.user_id);
  await db.prepare('UPDATE email_verifications SET used = 1 WHERE id = ?').run(row.id);

  res.json({ ok: true });
}

/** POST /api/auth/resend-verification  (authenticated) */
async function resendVerification(req, res) {
  const user = await db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.email) return res.status(400).json({ error: 'This account has no email address to verify' });
  if (user.email_verified_at) return res.json({ ok: true, message: 'Your email is already verified' });

  await issueEmailVerification(user);
  res.json({ ok: true, message: 'Verification email sent' });
}


// ---- Linked devices: sign a new device in by approving a short code from one that is already signed in ----
const LINK_TTL_SECONDS = 120;
const LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike characters

/** POST /api/auth/device-link/start  { label } — the NEW device asks for a code to show on screen */
async function deviceLinkStart(req, res) {
  let code;
  for (let i = 0; i < 5 && !code; i++) {
    const c = Array.from(crypto.randomBytes(8), (b) => LINK_ALPHABET[b % LINK_ALPHABET.length]).join('');
    const clash = await db.prepare('SELECT code FROM device_links WHERE code = ? AND expires_at > ?').get(c, now());
    if (!clash) code = c;
  }
  if (!code) return res.status(503).json({ error: 'Try again' });
  const secret = crypto.randomBytes(24).toString('hex');
  await db.prepare('DELETE FROM device_links WHERE expires_at < ?').run(new Date(Date.now() - 3600000).toISOString());
  await db.prepare('INSERT INTO device_links (code, secret_hash, label, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(code, hashToken(secret), deviceLabelFrom(req, req.body?.label), 'pending', new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString(), now());
  res.status(201).json({ code, secret, expires_in: LINK_TTL_SECONDS });
}

/** POST /api/auth/device-link/approve  { code } — a signed-in device approves the new one */
async function deviceLinkApprove(req, res) {
  const code = String(req.body?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const row = await db.prepare('SELECT * FROM device_links WHERE code = ?').get(code);
  if (!row || row.expires_at < now()) return res.status(404).json({ error: 'Code not found or expired' });
  if (row.status !== 'pending') return res.status(409).json({ error: 'Code already used' });
  await db.prepare("UPDATE device_links SET status = 'approved', user_id = ? WHERE code = ? AND status = 'pending'").run(req.user.id, code);
  res.json({ ok: true, label: row.label });
}

/** POST /api/auth/device-link/claim  { code, secret } — the new device polls until approved, then receives its own session */
async function deviceLinkClaim(req, res) {
  const code = String(req.body?.code || '').toUpperCase();
  const row = await db.prepare('SELECT * FROM device_links WHERE code = ?').get(code);
  if (!row || typeof req.body?.secret !== 'string' || hashToken(req.body.secret) !== row.secret_hash) return res.status(404).json({ error: 'Code not found' });
  if (row.expires_at < now()) return res.status(410).json({ error: 'Code expired' });
  if (row.status === 'pending') return res.status(202).json({ status: 'pending' });
  if (row.status === 'claimed') return res.status(409).json({ error: 'Code already used' });
  const claimed = await db.prepare("UPDATE device_links SET status = 'claimed' WHERE code = ? AND status = 'approved'").run(code);
  if (!claimed.changes) return res.status(409).json({ error: 'Code already used' });
  const user = await db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(row.user_id);
  if (!user || user.status === 'suspended') return res.status(403).json({ error: 'Account unavailable' });
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  await storeRefreshToken(user.id, refreshToken, row.label);
  res.json({ status: 'approved', user: sanitizeUser(user), access_token: accessToken, refresh_token: refreshToken });
}

/** GET /api/auth/devices — this account's signed-in devices (send X-Refresh-Token to mark the current one) */
async function listDevices(req, res) {
  const cur = req.get('x-refresh-token');
  const curHash = cur ? hashToken(cur) : null;
  const rows = await db.prepare(
    'SELECT id, token_hash, device_label, created_at, last_used_at FROM refresh_tokens WHERE user_id = ? AND revoked = 0 AND expires_at > ? ORDER BY COALESCE(last_used_at, created_at) DESC'
  ).all(req.user.id, now());
  res.json({ devices: rows.map((r) => ({ id: r.id, label: r.device_label || 'Unknown device', created_at: r.created_at, last_used_at: r.last_used_at, current: !!curHash && r.token_hash === curHash })) });
}

/** DELETE /api/auth/devices/:id — sign a device out remotely (its access token expires within 15 min) */
async function revokeDevice(req, res) {
  const r = await db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Device not found' });
  res.json({ ok: true });
}

module.exports = {
  deviceLinkStart, deviceLinkApprove, deviceLinkClaim, listDevices, revokeDevice,
  signup, login, refresh, logout,
  forgotPassword, resetPassword,
  verifyEmail, resendVerification,
  sanitizeUser,
  issueEmailVerification, issuePasswordReset,
};
