const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');

function now() {
  return new Date().toISOString();
}

/** POST /api/push-tokens  body: { token, platform } */
async function register(req, res) {
  const { token, platform } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token is required' });
  const validPlatform = ['ios', 'android', 'web'].includes(platform) ? platform : 'unknown';

  const existing = await db.prepare('SELECT id FROM push_tokens WHERE token = ?').get(token);
  const ts = now();
  if (existing) {
    // Re-registering an existing token re-points it at whoever is now
    // signed in — covers the common case of two accounts sharing one
    // device (log out, log in as someone else).
    await db.prepare('UPDATE push_tokens SET user_id = ?, platform = ?, updated_at = ? WHERE id = ?')
      .run(req.user.id, validPlatform, ts, existing.id);
  } else {
    await db.prepare(
      `INSERT INTO push_tokens (id, user_id, token, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(uuidv4(), req.user.id, token, validPlatform, ts, ts);
  }
  res.status(201).json({ registered: true });
}

/** DELETE /api/push-tokens  body: { token }  — call on logout so a signed-out device stops receiving push for that user. */
async function unregister(req, res) {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token is required' });
  await db.prepare('DELETE FROM push_tokens WHERE token = ? AND user_id = ?').run(token, req.user.id);
  res.json({ removed: true });
}

module.exports = { register, unregister };
