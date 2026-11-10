const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test'), override: true });
const { Pool } = require('pg');

module.exports = async function globalSetup() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await require('../src/db/migrate').applyAll(pool);

  // The badge catalog is referenced by code from gamification tests
  // (and from the real award logic in src/services/gamification.js),
  // so it needs to exist before any test runs — mirrors `npm run
  // seed:badges` for dev/prod.
  const { randomUUID } = require('crypto');
  const now = new Date().toISOString();
  const badges = [
    ['first_lesson', 'First Lesson', 'milestone'],
    ['streak_3', '3-Day Streak', 'streak'],
    ['streak_7', '7-Day Streak', 'streak'],
    ['streak_30', '30-Day Streak', 'streak'],
    ['points_500', 'Rising Star', 'milestone'],
  ];
  for (const [code, name, category] of badges) {
    await pool.query(
      'INSERT INTO badges (id, code, name, category, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5) ON CONFLICT (code) DO NOTHING',
      [randomUUID(), code, name, category, now]
    );
  }

  await pool.end();
};
