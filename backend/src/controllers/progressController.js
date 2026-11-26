const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');
const { notifyUser, templates } = require('../services/notifications');
const { recomputeProgress } = require('../services/progress');

function now() {
  return new Date().toISOString();
}

function textField(body, key, max, { required = false } = {}) {
  const raw = body[key];
  if (raw === undefined || raw === null || raw === '') {
    return required ? { error: `${key} is required` } : { value: null };
  }
  if (typeof raw !== 'string') return { error: `${key} must be text` };
  const v = raw.trim();
  if (required && !v) return { error: `${key} is required` };
  if (v.length > max) return { error: `${key} must be at most ${max} characters` };
  return { value: v || null };
}

function intField(body, key, min, max) {
  const raw = body[key];
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return { error: `${key} must be a whole number from ${min} to ${max}` };
  return { value: n };
}

/** True if the user is the child on this booking (signed in as a child). */
async function isChildOf(user, childId) {
  if (user.role !== 'child' || !childId) return false;
  const c = await db.prepare('SELECT user_id FROM children WHERE id = ?').get(childId);
  return !!c && c.user_id === user.id;
}

/**
 * PUT /api/bookings/:id/report  (the booking's tutor)
 * body: { summary, strengths?, next_steps?, homework?, score? 0-100, engagement? 1-5 }
 * Writes (or updates) the tutor's notes for a confirmed or completed lesson.
 */
async function upsertReport(req, res) {
  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.tutor_id !== req.user.id) return res.status(403).json({ error: 'Only the tutor who taught this lesson can write its report' });
  if (!['confirmed', 'completed'].includes(booking.status)) {
    return res.status(400).json({ error: `A ${booking.status} lesson can't have a report` });
  }

  const body = req.body || {};
  const fields = {
    summary: textField(body, 'summary', 4000, { required: true }),
    strengths: textField(body, 'strengths', 2000),
    next_steps: textField(body, 'next_steps', 2000),
    homework: textField(body, 'homework', 2000),
    score: intField(body, 'score', 0, 100),
    engagement: intField(body, 'engagement', 1, 5),
  };
  const bad = Object.values(fields).find((f) => f.error);
  if (bad) return res.status(400).json({ error: bad.error });
  const v = Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.value]));

  const existing = await db.prepare('SELECT id FROM lesson_reports WHERE booking_id = ?').get(booking.id);
  const ts = now();
  if (existing) {
    await db.prepare(
      `UPDATE lesson_reports SET summary = ?, strengths = ?, next_steps = ?, homework = ?, score = ?, engagement = ?,
              skill_id = ?, child_id = ?, updated_at = ? WHERE id = ?`
    ).run(v.summary, v.strengths, v.next_steps, v.homework, v.score, v.engagement, booking.skill_id, booking.child_id, ts, existing.id);
  } else {
    await db.prepare(
      `INSERT INTO lesson_reports (id, booking_id, tutor_id, child_id, skill_id, summary, strengths, next_steps, homework, score, engagement, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(uuidv4(), booking.id, req.user.id, booking.child_id, booking.skill_id, v.summary, v.strengths, v.next_steps, v.homework, v.score, v.engagement, ts, ts);
  }

  if (booking.status === 'completed') await recomputeProgress(booking.child_id, booking.skill_id);

  if (!existing) {
    const [parent, tutor] = await Promise.all([
      db.prepare('SELECT * FROM users WHERE id = ?').get(booking.parent_id),
      db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id),
    ]);
    if (parent) await notifyUser(parent, templates.lessonReportReady(tutor.full_name, booking.subject));
  }

  const report = await db.prepare('SELECT * FROM lesson_reports WHERE booking_id = ?').get(booking.id);
  res.status(existing ? 200 : 201).json({ report });
}

/** GET /api/bookings/:id/report  (tutor, payer, the child, admin) */
async function getReport(req, res) {
  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  const allowed = req.user.role === 'super_admin' || [booking.tutor_id, booking.parent_id].includes(req.user.id) ||
    (await isChildOf(req.user, booking.child_id));
  if (!allowed) return res.status(403).json({ error: 'Not your booking' });
  const report = await db.prepare('SELECT * FROM lesson_reports WHERE booking_id = ?').get(booking.id);
  if (!report) return res.status(404).json({ error: 'No report for this lesson yet' });
  res.json({ report });
}

/** Builds the full progress report for one child. */
async function buildChildReport(child) {
  const [skills, reports, upcoming, badges, streak, assignments] = await Promise.all([
    db.prepare(
      `SELECT p.*, s.name AS skill_name, s.category, s.icon
         FROM child_skill_progress p JOIN skills s ON s.id = p.skill_id
        WHERE p.child_id = ? ORDER BY p.completed_lessons DESC, s.name`
    ).all(child.id),
    db.prepare(
      `SELECT r.*, b.scheduled_at, b.subject, u.full_name AS tutor_name, s.name AS skill_name
         FROM lesson_reports r
         JOIN bookings b ON b.id = r.booking_id
         JOIN users u ON u.id = r.tutor_id
         LEFT JOIN skills s ON s.id = r.skill_id
        WHERE r.child_id = ? ORDER BY COALESCE(b.scheduled_at, r.created_at) DESC LIMIT 50`
    ).all(child.id),
    db.prepare(
      `SELECT b.id, b.subject, b.scheduled_at, b.duration_minutes, b.status, u.full_name AS tutor_name
         FROM bookings b JOIN users u ON u.id = b.tutor_id
        WHERE b.child_id = ? AND b.status = 'confirmed' AND b.deleted_at IS NULL AND b.scheduled_at >= ?
        ORDER BY b.scheduled_at LIMIT 10`
    ).all(child.id, new Date().toISOString()),
    child.user_id
      ? db.prepare(
        `SELECT b.code, b.name, b.icon, b.category, ub.awarded_at
           FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
          WHERE ub.user_id = ? ORDER BY ub.awarded_at DESC`
      ).all(child.user_id)
      : Promise.resolve([]),
    db.prepare('SELECT * FROM child_streaks WHERE child_id = ?').get(child.id),
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'graded' THEN 1 ELSE 0 END) AS graded,
              SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) AS open
         FROM assignments WHERE child_id = ? AND deleted_at IS NULL`
    ).get(child.id),
  ]);

  const totals = (await db.prepare(
    `SELECT COUNT(*) AS completed, COALESCE(SUM(duration_minutes), 0) AS minutes
       FROM bookings WHERE child_id = ? AND status = 'completed' AND deleted_at IS NULL`
  ).get(child.id));
  const scored = reports.filter((r) => r.score !== null && r.score !== undefined);

  return {
    child: { id: child.id, full_name: child.full_name, age: child.age, grade_level: child.grade_level, school_name: child.school_name, learning_needs: child.learning_needs },
    summary: {
      completed_lessons: Number(totals.completed) || 0,
      hours_learned: Math.round(((Number(totals.minutes) || 0) / 60) * 10) / 10,
      average_score: scored.length ? Math.round((scored.reduce((a, r) => a + Number(r.score), 0) / scored.length) * 10) / 10 : null,
      skills_in_progress: skills.length,
      assignments: { total: Number(assignments?.total) || 0, graded: Number(assignments?.graded) || 0, open: Number(assignments?.open) || 0 },
      streak: streak ? { current: streak.current_streak, longest: streak.longest_streak, points: streak.total_points } : null,
    },
    skills: skills.map((s) => ({ ...s, average_score: s.average_score === null ? null : Number(s.average_score) })),
    recent_reports: reports,
    upcoming_lessons: upcoming,
    badges,
  };
}

/** GET /api/progress/children/:childId  (parent of the child, the child, a tutor who has taught them, admin) */
async function childProgress(req, res) {
  const child = await db.prepare('SELECT * FROM children WHERE id = ? AND deleted_at IS NULL').get(req.params.childId);
  if (!child) return res.status(404).json({ error: 'Child not found' });

  let allowed = req.user.role === 'super_admin' || child.parent_id === req.user.id || child.user_id === req.user.id;
  if (!allowed && req.user.role === 'tutor') {
    const taught = await db.prepare(
      "SELECT id FROM bookings WHERE tutor_id = ? AND child_id = ? AND status IN ('confirmed','completed') AND deleted_at IS NULL LIMIT 1"
    ).get(req.user.id, child.id);
    allowed = !!taught;
  }
  if (!allowed) return res.status(403).json({ error: "You can't view this child's progress" });

  res.json(await buildChildReport(child));
}

/** GET /api/progress/me  (child) */
async function myProgress(req, res) {
  const child = await db.prepare('SELECT * FROM children WHERE user_id = ? AND deleted_at IS NULL').get(req.user.id);
  if (!child) return res.status(404).json({ error: 'No linked child record found' });
  res.json(await buildChildReport(child));
}

/** GET /api/progress/family  (parent) — one compact card per child */
async function familyProgress(req, res) {
  const children = await db.prepare('SELECT * FROM children WHERE parent_id = ? AND deleted_at IS NULL ORDER BY full_name').all(req.user.id);
  const cards = [];
  for (const child of children) {
    const r = await buildChildReport(child);
    cards.push({ child: r.child, summary: r.summary, skills: r.skills.slice(0, 5), next_lesson: r.upcoming_lessons[0] || null });
  }
  res.json({ children: cards });
}

module.exports = { upsertReport, getReport, childProgress, myProgress, familyProgress, buildChildReport };
