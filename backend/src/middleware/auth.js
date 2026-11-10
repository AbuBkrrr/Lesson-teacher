const { verifyAccessToken } = require('../utils/jwt');
const db = require('../config/db');

// Suspension must bite immediately, not when the 15-minute access token expires.
// A short per-process cache keeps this to ~one cheap query per user per 30s;
// suspend/reactivate call forgetUserStatus() so this process reacts instantly.
const STATUS_TTL_MS = 30000;
const statusCache = new Map();
async function isSuspended(userId) {
  const hit = statusCache.get(userId);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.suspended;
  const row = await db.prepare('SELECT status, deleted_at FROM users WHERE id = ?').get(userId);
  const suspended = !row || row.status === 'suspended' || !!row.deleted_at;
  statusCache.set(userId, { suspended, at: Date.now() });
  return suspended;
}
function forgetUserStatus(userId) {
  statusCache.delete(userId);
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role, school_id: payload.school_id };
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  try {
    if (await isSuspended(req.user.id)) {
      return res.status(403).json({ error: 'This account has been suspended' });
    }
  } catch (err) {
    return next(err);
  }
  next();
}

/**
 * Usage: requireRole('super_admin') or requireRole('super_admin', 'school_admin')
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions for this action' });
    }
    next();
  };
}

/**
 * Hard gate: identity verification must be approved by a super_admin
 * before a user can book a lesson, accept/teach one, apply to or
 * accept a lesson request, or withdraw earnings. req.user only
 * carries what was in the JWT at login time (id/role/school_id), so
 * verification status — which can change after that token was issued
 * — is always re-read from the database here, never trusted from the
 * token.
 */
function requireVerified() {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    try {
      const row = await db.prepare('SELECT id_verification_status FROM users WHERE id = ?').get(req.user.id);
      if (!row || row.id_verification_status !== 'verified') {
        return res.status(403).json({
          error: 'Your identity verification must be approved before you can do this. Upload a valid ID under your account and wait for approval.',
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireAuth, requireRole, requireVerified, forgetUserStatus };
