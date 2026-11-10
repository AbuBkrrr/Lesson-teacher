/**
 * Run with: npm run seed:admin -- --email admin@lessonteacher.com --password ChangeMe123! --name "Platform Admin"
 * Creates the first super_admin account. super_admin cannot be created
 * through the public /api/auth/signup endpoint on purpose.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { uuidv4, generateUniqueReferralCode } = require('../utils/referral');

function getArg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : fallback;
}

async function main() {
  await db.ready();

  const email = getArg('email', 'admin@lessonteacher.com');
  const password = getArg('password', 'ChangeMe123!');
  const name = getArg('name', 'Platform Admin');

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    console.log(`A user with email ${email} already exists (id: ${existing.id}). Nothing to do.`);
    process.exit(0);
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  const passwordHash = bcrypt.hashSync(password, 10);
  const referralCode = await generateUniqueReferralCode(db);

  await db.prepare(
    `INSERT INTO users (id, role, full_name, email, phone, password_hash, referral_code, status, created_at, updated_at)
     VALUES (?, 'super_admin', ?, ?, NULL, ?, ?, 'active', ?, ?)`
  ).run(id, name, email, passwordHash, referralCode, now, now);

  console.log('Super admin created:');
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log(`  id:       ${id}`);
  console.log('Log in via POST /api/auth/login with this email + password.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
