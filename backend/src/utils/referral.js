const { randomUUID: uuidv4 } = require('crypto');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 ambiguity

function generateReferralCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  }
  return `LT-${code}`;
}

async function generateUniqueReferralCode(db) {
  let code;
  do {
    code = generateReferralCode();
  } while (await db.prepare('SELECT id FROM users WHERE referral_code = ?').get(code));
  return code;
}

/**
 * At signup, the person can enter the referring marketer's email, phone,
 * or referral code — we try all three so marketers can share whichever
 * they find easiest.
 */
async function resolveMarketer(db, identifier) {
  if (!identifier || !identifier.trim()) return null;
  const value = identifier.trim();
  return db
    .prepare(`SELECT * FROM users WHERE (email = ? OR phone = ? OR referral_code = ?) AND deleted_at IS NULL`)
    .get(value, value, value.toUpperCase());
}

function generateJoinCode() {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  }
  return `SCH-${code}`;
}

async function generateUniqueJoinCode(db) {
  let code;
  do {
    code = generateJoinCode();
  } while (await db.prepare('SELECT id FROM schools WHERE join_code = ?').get(code));
  return code;
}

module.exports = {
  uuidv4,
  generateUniqueReferralCode,
  resolveMarketer,
  generateUniqueJoinCode,
};
