#!/usr/bin/env node
// Sends a "lesson starting soon" notification to both parties on a booking
// shortly before it starts. Meant to run on an external schedule (e.g. a
// cron entry or hosting-platform scheduled job) hitting this script every
// 5-10 minutes — this process does not schedule itself.
//
// Usage: node scripts/sendLessonReminders.js
//
// Window: a booking is reminded once its scheduled_at falls within
// [now + LOOKAHEAD_MIN - WINDOW_MIN, now + LOOKAHEAD_MIN], so a run cadence
// shorter than WINDOW_MIN guarantees every booking is caught exactly once
// without needing second-level cron precision. `reminder_sent_at` makes the
// send idempotent regardless of how often the script actually runs.
const db = require('../src/config/db');
const { notifyUser, templates } = require('../src/services/notifications');

const LOOKAHEAD_MIN = Number(process.env.REMINDER_LOOKAHEAD_MINUTES || 60);
const WINDOW_MIN = Number(process.env.REMINDER_WINDOW_MINUTES || 15);

function now() {
  return new Date().toISOString();
}

/**
 * Runs one sweep: finds confirmed, not-yet-reminded bookings and notifies
 * both the parent (or the child's own account, if it's a child-led session
 * isn't modeled — bookings are parent-owned, so the parent is notified) and
 * the tutor. Returns the list of booking ids it reminded, for tests.
 */
async function runReminderSweep() {
  const candidates = await db.prepare(
    `SELECT * FROM bookings
     WHERE status = 'confirmed' AND deleted_at IS NULL
       AND reminder_sent_at IS NULL AND scheduled_at IS NOT NULL`
  ).all();

  const nowMs = Date.now();
  const windowStart = nowMs + (LOOKAHEAD_MIN - WINDOW_MIN) * 60 * 1000;
  const windowEnd = nowMs + LOOKAHEAD_MIN * 60 * 1000;

  const reminded = [];

  for (const booking of candidates) {
    const startMs = new Date(booking.scheduled_at).getTime();
    if (Number.isNaN(startMs)) continue; // unparseable scheduled_at — nothing to compare, skip safely
    if (startMs < windowStart || startMs > windowEnd) continue;

    const [parentUser, tutorUser] = await Promise.all([
      db.prepare('SELECT * FROM users WHERE id = ?').get(booking.parent_id),
      db.prepare('SELECT * FROM users WHERE id = ?').get(booking.tutor_id),
    ]);

    if (parentUser && tutorUser) {
      await Promise.all([
        notifyUser(parentUser, templates.lessonStartingSoon(tutorUser.full_name, booking.subject, booking.scheduled_at)),
        notifyUser(tutorUser, templates.lessonStartingSoon(parentUser.full_name, booking.subject, booking.scheduled_at)),
      ]);
    }

    await db.prepare('UPDATE bookings SET reminder_sent_at = ? WHERE id = ?').run(now(), booking.id);
    reminded.push(booking.id);
  }

  return reminded;
}

if (require.main === module) {
  (async () => {
    const reminded = await runReminderSweep();
    console.log(`[sendLessonReminders] reminded ${reminded.length} booking(s): ${reminded.join(', ') || '(none)'}`);
    await db.pool.end();
  })().catch((err) => {
    console.error('[sendLessonReminders] failed:', err);
    process.exit(1);
  });
}

module.exports = { runReminderSweep };
