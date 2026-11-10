/**
 * Run with: npm run seed:badges
 * Idempotent — safe to run multiple times, skips badges that already exist.
 *
 * These are platform-recognition badges only — completion/engagement
 * milestones, never government or academic credentials.
 */
require('dotenv').config();
const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');

const BADGES = [
  { code: 'first_lesson', name: 'First Lesson', category: 'milestone', icon: '\u{1F31F}', description: 'Completed your very first lesson or assignment.' },
  { code: 'streak_3', name: '3-Day Streak', category: 'streak', icon: '\u{1F525}', description: 'Showed up 3 days in a row.' },
  { code: 'streak_7', name: '7-Day Streak', category: 'streak', icon: '\u{1F525}', description: 'Showed up 7 days in a row.' },
  { code: 'streak_30', name: '30-Day Streak', category: 'streak', icon: '\u{1F3C6}', description: 'Showed up 30 days in a row — incredible consistency!' },
  { code: 'points_500', name: 'Rising Star', category: 'milestone', icon: '⭐', description: 'Earned 500 points on the platform.' },
];

async function main() {
  await db.ready();

  let inserted = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const badge of BADGES) {
    const existing = await db.prepare('SELECT id FROM badges WHERE code = ?').get(badge.code);
    if (existing) { skipped++; continue; }
    await db.prepare(
      'INSERT INTO badges (id, code, name, description, icon, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), badge.code, badge.name, badge.description, badge.icon, badge.category, now, now);
    inserted++;
  }

  console.log(`Badge catalog seeded: ${inserted} added, ${skipped} already existed.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
