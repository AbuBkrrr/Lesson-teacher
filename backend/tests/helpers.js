const request = require('supertest');
const { createApp } = require('../src/app');

function getApp() {
  return createApp();
}

let counter = 0;
function unique(prefix) {
  counter += 1;
  return `${prefix}${Date.now()}${counter}`;
}

async function signup(app, overrides = {}) {
  const email = overrides.email || `${unique('user')}@example.com`;
  const payload = {
    role: 'parent',
    full_name: 'Test User',
    email,
    password: 'TestPass123',
    ...overrides,
  };
  const res = await request(app).post('/api/auth/signup').send(payload);
  return { res, email, password: payload.password };
}

async function signupParent(app, overrides = {}) {
  return signup(app, { role: 'parent', full_name: 'Test Parent', ...overrides });
}

async function signupTutor(app, overrides = {}) {
  return signup(app, { role: 'tutor', full_name: 'Test Tutor', ...overrides });
}

async function signupSchoolAdmin(app, overrides = {}) {
  return signup(app, {
    role: 'school_admin',
    full_name: 'Test School Admin',
    school_name: overrides.school_name || `${unique('School')}`,
    ...overrides,
  });
}

async function signupAdultStudent(app, overrides = {}) {
  return signup(app, {
    role: 'adult_student',
    full_name: 'Test Adult Student',
    date_of_birth: '2000-01-01',
    ...overrides,
  });
}

/** Directly marks a user's identity verification as approved, bypassing the hard gate for tests that need a verified user. */
async function verifyUser(userId) {
  const db = require('../src/config/db');
  await db.prepare("UPDATE users SET id_verification_status = 'verified', id_verified_at = ? WHERE id = ?")
    .run(new Date().toISOString(), userId);
}

/** Directly inserts a super_admin (bypassing the no-self-signup rule) for tests that need one. */
async function createSuperAdmin() {
  const bcrypt = require('bcryptjs');
  const db = require('../src/config/db');
  const { uuidv4, generateUniqueReferralCode } = require('../src/utils/referral');

  const email = `${unique('admin')}@example.com`;
  const password = 'AdminPass123';
  const id = uuidv4();
  const now = new Date().toISOString();
  const passwordHash = bcrypt.hashSync(password, 10);
  const referralCode = await generateUniqueReferralCode(db);

  await db.prepare(
    `INSERT INTO users (id, role, full_name, email, password_hash, referral_code, status, created_at, updated_at)
     VALUES (?, 'super_admin', 'Test Admin', ?, ?, ?, 'active', ?, ?)`
  ).run(id, email, passwordHash, referralCode, now, now);

  return { id, email, password };
}

module.exports = { getApp, unique, signup, signupParent, signupTutor, signupSchoolAdmin, signupAdultStudent, createSuperAdmin, verifyUser };
