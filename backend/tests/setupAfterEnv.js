const db = require('../src/config/db');
const cache = require('../src/services/cache');

const TABLES = [
  'messages', 'conversations', 'child_invites', 'refresh_tokens', 'payouts', 'payments',
  'referrals', 'auditions', 'bookings', 'tutor_skills', 'skills', 'tutor_profiles',
  'children', 'users', 'schools', 'platform_settings',
];

beforeAll(async () => {
  await db.ready();
});

beforeEach(async () => {
  // Fast, full reset between tests — simpler and more reliable than
  // trying to track exactly what each test touched. RESTART IDENTITY
  // isn't needed since every table uses UUID primary keys, not serials.
  await db.exec(`TRUNCATE TABLE ${TABLES.join(', ')} CASCADE`);
});

afterAll(async () => {
  await db.pool.end();
  await cache.quit();
});
