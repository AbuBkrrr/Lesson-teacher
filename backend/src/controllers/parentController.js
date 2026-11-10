const db = require('../config/db');

/**
 * GET /api/parents/me/dashboard  (parent)
 *
 * Deliberately does NOT include a "progress" percentage — there's no
 * lesson-outcome or skill-mastery tracking anywhere in this system to back
 * one, and a dashboard stat with no real data behind it is worse than no
 * stat at all. Everything here is derived from bookings/children that
 * actually exist.
 */
async function dashboard(req, res) {
  const parentId = req.user.id;

  const childrenCount = await db
    .prepare('SELECT COUNT(*)::int AS count FROM children WHERE parent_id = ? AND deleted_at IS NULL')
    .get(parentId);

  const activeTutorsCount = await db
    .prepare(
      `SELECT COUNT(DISTINCT tutor_id)::int AS count FROM bookings
       WHERE parent_id = ? AND status = 'confirmed' AND deleted_at IS NULL`
    )
    .get(parentId);

  // "This month" = the calendar month the request lands in, computed in
  // SQL (date_trunc) rather than in JS, so it's correct regardless of the
  // server's or client's local timezone.
  const lessonsThisMonth = await db
    .prepare(
      `SELECT COUNT(*)::int AS count FROM bookings
       WHERE parent_id = ? AND status = 'completed' AND deleted_at IS NULL
       AND updated_at::timestamptz >= date_trunc('month', now())`
    )
    .get(parentId);

  const children = await db
    .prepare('SELECT id, full_name, grade_level, user_id FROM children WHERE parent_id = ? AND deleted_at IS NULL ORDER BY full_name')
    .all(parentId);

  const childSubjectRows = await db
    .prepare(
      `SELECT DISTINCT child_id, subject FROM bookings
       WHERE parent_id = ? AND child_id IS NOT NULL AND subject IS NOT NULL
       AND status IN ('confirmed', 'completed') AND deleted_at IS NULL`
    )
    .all(parentId);
  const subjectsByChild = {};
  for (const row of childSubjectRows) {
    (subjectsByChild[row.child_id] ||= []).push(row.subject);
  }

  const tutorRows = await db
    .prepare(
      `SELECT DISTINCT ON (b.tutor_id)
         b.tutor_id, u.full_name, tp.rating, tp.review_count,
         bool_or(b.status = 'confirmed') OVER (PARTITION BY b.tutor_id) AS is_active
       FROM bookings b
       JOIN users u ON u.id = b.tutor_id
       LEFT JOIN tutor_profiles tp ON tp.user_id = b.tutor_id
       WHERE b.parent_id = ? AND b.status IN ('confirmed', 'completed') AND b.deleted_at IS NULL`
    )
    .all(parentId);

  const tutorSubjectRows = await db
    .prepare(
      `SELECT DISTINCT tutor_id, subject FROM bookings
       WHERE parent_id = ? AND subject IS NOT NULL AND status IN ('confirmed', 'completed') AND deleted_at IS NULL`
    )
    .all(parentId);
  const subjectsByTutor = {};
  for (const row of tutorSubjectRows) {
    (subjectsByTutor[row.tutor_id] ||= []).push(row.subject);
  }

  res.json({
    children_count: childrenCount.count,
    active_tutors_count: activeTutorsCount.count,
    lessons_this_month_count: lessonsThisMonth.count,
    children: children.map((c) => ({
      id: c.id,
      full_name: c.full_name,
      grade_level: c.grade_level,
      has_login: !!c.user_id,
      subjects: subjectsByChild[c.id] || [],
    })),
    tutors: tutorRows.map((t) => ({
      id: t.tutor_id,
      full_name: t.full_name,
      rating: t.rating || 0,
      review_count: t.review_count || 0,
      subjects: subjectsByTutor[t.tutor_id] || [],
      status: t.is_active ? 'active' : 'past',
    })),
  });
}

module.exports = { dashboard };
