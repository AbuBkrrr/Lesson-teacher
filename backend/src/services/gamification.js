const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');

function now() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

/** Awards a badge once (idempotent) if the child doesn't already have it. */
async function awardBadge(childUserId, badgeCode) {
  if (!childUserId) return; // a child row with no linked login yet has nothing to award
  const badge = await db.prepare('SELECT id FROM badges WHERE code = ? AND deleted_at IS NULL').get(badgeCode);
  if (!badge) return; // catalog not seeded with this code — skip rather than fail the caller's flow

  const existing = await db.prepare('SELECT id FROM user_badges WHERE user_id = ? AND badge_id = ?').get(childUserId, badge.id);
  if (existing) return;

  await db
    .prepare('INSERT INTO user_badges (id, user_id, badge_id, awarded_at) VALUES (?, ?, ?, ?)')
    .run(uuidv4(), childUserId, badge.id, now());
}

/**
 * Records one qualifying activity (a completed lesson, an assignment
 * submission) for a child: updates the daily streak and awards points,
 * then checks for milestone/streak badges. Safe to call multiple times
 * the same day — only the first call each day advances the streak.
 *
 * @param {string} childId - children.id (NOT the child's user_id)
 * @param {number} points - points to add for this activity
 */
async function recordActivity(childId, points = 10) {
  if (!childId) return;

  const child = await db.prepare('SELECT id, user_id FROM children WHERE id = ?').get(childId);
  if (!child) return;

  let streak = await db.prepare('SELECT * FROM child_streaks WHERE child_id = ?').get(childId);
  const todayStr = today();

  if (!streak) {
    streak = { child_id: childId, current_streak: 1, longest_streak: 1, total_points: points, last_activity_on: todayStr };
    await db
      .prepare('INSERT INTO child_streaks (child_id, current_streak, longest_streak, total_points, last_activity_on, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(childId, 1, 1, points, todayStr, now());
  } else if (streak.last_activity_on === todayStr) {
    // Already counted today — just add points, streak unchanged.
    streak.total_points += points;
    await db.prepare('UPDATE child_streaks SET total_points = ?, updated_at = ? WHERE child_id = ?').run(streak.total_points, now(), childId);
  } else {
    const gap = streak.last_activity_on ? daysBetween(streak.last_activity_on, todayStr) : null;
    const nextStreak = gap === 1 ? streak.current_streak + 1 : 1; // a gap of exactly one day continues it; anything else resets to 1
    const nextLongest = Math.max(streak.longest_streak, nextStreak);
    const nextPoints = streak.total_points + points;

    await db
      .prepare('UPDATE child_streaks SET current_streak = ?, longest_streak = ?, total_points = ?, last_activity_on = ?, updated_at = ? WHERE child_id = ?')
      .run(nextStreak, nextLongest, nextPoints, todayStr, now(), childId);

    streak = { ...streak, current_streak: nextStreak, longest_streak: nextLongest, total_points: nextPoints, last_activity_on: todayStr };
  }

  // Milestone/streak badges — checked every call; awardBadge is idempotent.
  const totalActivities = Number(
    (await db.prepare(
      `SELECT (SELECT COUNT(*) FROM assignments WHERE child_id = ? AND status IN ('submitted','graded')) +
              (SELECT COUNT(*) FROM bookings WHERE child_id = ? AND status = 'completed') AS total`
    ).get(childId, childId)).total
  );

  if (totalActivities >= 1) await awardBadge(child.user_id, 'first_lesson');
  if (streak.current_streak >= 3) await awardBadge(child.user_id, 'streak_3');
  if (streak.current_streak >= 7) await awardBadge(child.user_id, 'streak_7');
  if (streak.current_streak >= 30) await awardBadge(child.user_id, 'streak_30');
  if (streak.total_points >= 500) await awardBadge(child.user_id, 'points_500');

  return streak;
}

module.exports = { recordActivity, awardBadge };
