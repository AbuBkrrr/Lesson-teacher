const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Dev/test fall back to well-known secrets; production must supply real ones,
// otherwise anyone could forge tokens (including super_admin) from the public
// default strings. Fail at boot rather than run insecurely.
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET)) {
  throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in production');
}
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me';
const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
const REFRESH_TTL_DAYS = Number(process.env.JWT_REFRESH_TTL_DAYS || 30);

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, school_id: user.school_id || null },
    ACCESS_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

function signRefreshToken(user) {
  // `jti` keeps every issued refresh token unique even when two are signed
  // for the same user within the same second (e.g. signup immediately
  // followed by a login) — without it, { sub } + a second-granularity `iat`
  // can produce byte-identical JWTs, which collide on the same token_hash
  // in refresh_tokens and make the two sessions indistinguishable.
  return jwt.sign({ sub: user.id, jti: crypto.randomUUID() }, REFRESH_SECRET, { expiresIn: `${REFRESH_TTL_DAYS}d` });
}

function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  REFRESH_TTL_DAYS,
};
