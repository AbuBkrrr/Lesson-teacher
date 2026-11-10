// @ts-check
/**
 * Per child, per skill progress. Derived data: it is recomputed from the
 * child's completed bookings and the tutors' lesson reports whenever either
 * changes, so it can never drift from the source rows.
 */
const db = require('../config/db');

/**
 * Level rules (kept simple and explainable to parents):
 *  - expert:       20+ completed lessons and average score >= 80
 *  - advanced:     10+ completed lessons and average score >= 70
 *  - intermediate:  4+ completed lessons
 *  - beginner:     otherwise
 * Lessons without a scored report don't count toward the average.
 * @param {number} completed
 * @param {number|null} avg
 */
function levelFor(completed, avg) {
  const score = avg === null ? 0 : avg;
  if (completed >= 20 && score >= 80) return 'expert';
  if (completed >= 10 && score >= 70) return 'advanced';
  if (completed >= 4) return 'intermediate';
  return 'beginner';
}

/** Recomputes one (child, skill) row. No-op when either id is missing. */
async function recomputeProgress(childId, skillId) {
  if (!childId || !skillId) return null;
  const stats = await db.prepare(
    `SELECT COUNT(*) AS completed,
            AVG(r.score) AS avg_score,
            MAX(COALESCE(b.scheduled_at, b.updated_at)) AS last_at
       FROM bookings b
       LEFT JOIN lesson_reports r ON r.booking_id = b.id
      WHERE b.child_id = ? AND b.skill_id = ? AND b.status = 'completed' AND b.deleted_at IS NULL`
  ).get(childId, skillId);

  const completed = Number(stats.completed) || 0;
  const avg = stats.avg_score === null || stats.avg_score === undefined ? null : Math.round(Number(stats.avg_score) * 100) / 100;
  const level = levelFor(completed, avg);
  const ts = new Date().toISOString();

  await db.prepare(
    `INSERT INTO child_skill_progress (child_id, skill_id, level, completed_lessons, average_score, last_lesson_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (child_id, skill_id) DO UPDATE SET
       level = EXCLUDED.level, completed_lessons = EXCLUDED.completed_lessons,
       average_score = EXCLUDED.average_score, last_lesson_at = EXCLUDED.last_lesson_at, updated_at = EXCLUDED.updated_at`
  ).run(childId, skillId, level, completed, avg, stats.last_at || null, ts);

  return { child_id: childId, skill_id: skillId, level, completed_lessons: completed, average_score: avg };
}

module.exports = { levelFor, recomputeProgress };
