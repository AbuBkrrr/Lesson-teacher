const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');
const { notifyUser, templates } = require('../services/notifications');
const { recordActivity } = require('../services/gamification');

function now() {
  return new Date().toISOString();
}

/** Adult students book for themselves (bookings.child_id is NULL, bookings.parent_id is the student). */
async function verifyStudentRelationship(tutorId, studentId) {
  return db.prepare(
    `SELECT id FROM bookings WHERE tutor_id = ? AND parent_id = ? AND child_id IS NULL AND status IN ('confirmed','completed') AND deleted_at IS NULL LIMIT 1`
  ).get(tutorId, studentId);
}

async function verifyRelationship(tutorId, childId) {
  return db.prepare(
    `SELECT id FROM bookings WHERE tutor_id = ? AND child_id = ? AND status IN ('confirmed','completed') AND deleted_at IS NULL LIMIT 1`
  ).get(tutorId, childId);
}

/**
 * POST /api/assignments  (tutor)
 * body: { child_id, title, instructions, due_at?, curriculum_unit_id?, booking_id? }
 */
async function create(req, res) {
  const { child_id, student_user_id, title, instructions, due_at, curriculum_unit_id, booking_id } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (!child_id === !student_user_id) {
    return res.status(400).json({ error: 'Provide exactly one of child_id (a child) or student_user_id (an adult student)' });
  }

  if (student_user_id) {
    const student = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'adult_student' AND deleted_at IS NULL").get(student_user_id);
    if (!student) return res.status(404).json({ error: 'Adult student not found' });
    if (!(await verifyStudentRelationship(req.user.id, student_user_id))) {
      return res.status(403).json({ error: 'A confirmed booking with this student is required to assign work' });
    }
  } else if (!(await verifyRelationship(req.user.id, child_id))) {
    return res.status(403).json({ error: 'A confirmed booking with this child is required to assign work' });
  }

  const id = uuidv4();
  const ts = now();
  await db.prepare(
    `INSERT INTO assignments (id, tutor_id, child_id, student_user_id, booking_id, curriculum_unit_id, title, instructions, due_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'assigned', ?, ?)`
  ).run(id, req.user.id, child_id || null, student_user_id || null, booking_id || null, curriculum_unit_id || null, title, instructions || null, due_at || null, ts, ts);

  if (student_user_id) {
    const [studentUser, tutorUser] = await Promise.all([
      db.prepare('SELECT * FROM users WHERE id = ?').get(student_user_id),
      db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id),
    ]);
    await notifyUser(studentUser, templates.assignmentCreated(tutorUser.full_name, title));
    return res.status(201).json({ assignment: await db.prepare('SELECT * FROM assignments WHERE id = ?').get(id) });
  }

  // The recipient is always the parent, not the child directly — a child
  // account created via the invite-code flow has no email/phone on file
  // (only a username/password), so notifying the child record itself
  // would silently reach no one.
  const [child, tutorUser] = await Promise.all([
    db.prepare('SELECT parent_id FROM children WHERE id = ?').get(child_id),
    db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id),
  ]);
  const parentUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(child.parent_id);
  await notifyUser(parentUser, templates.assignmentCreated(tutorUser.full_name, title));

  res.status(201).json({ assignment: await db.prepare('SELECT * FROM assignments WHERE id = ?').get(id) });
}

/** GET /api/assignments/mine — tutor sees assignments they created, child sees their own, parent sees their child's */
async function listMine(req, res) {
  let rows;
  if (req.user.role === 'tutor') {
    rows = await db
      .prepare(
        `SELECT a.*, COALESCE(c.full_name, su.full_name) AS child_name FROM assignments a
         LEFT JOIN children c ON c.id = a.child_id LEFT JOIN users su ON su.id = a.student_user_id
         WHERE a.tutor_id = ? AND a.deleted_at IS NULL ORDER BY a.created_at DESC`
      )
      .all(req.user.id);
  } else if (req.user.role === 'child') {
    const child = await db.prepare('SELECT id FROM children WHERE user_id = ?').get(req.user.id);
    rows = child
      ? await db.prepare(`SELECT a.*, u.full_name AS tutor_name FROM assignments a JOIN users u ON u.id = a.tutor_id WHERE a.child_id = ? AND a.deleted_at IS NULL ORDER BY a.created_at DESC`).all(child.id)
      : [];
  } else if (req.user.role === 'adult_student') {
    rows = await db
      .prepare(`SELECT a.*, u.full_name AS tutor_name FROM assignments a JOIN users u ON u.id = a.tutor_id WHERE a.student_user_id = ? AND a.deleted_at IS NULL ORDER BY a.created_at DESC`)
      .all(req.user.id);
  } else if (req.user.role === 'parent') {
    rows = await db
      .prepare(
        `SELECT a.*, u.full_name AS tutor_name, c.full_name AS child_name
         FROM assignments a JOIN users u ON u.id = a.tutor_id JOIN children c ON c.id = a.child_id
         WHERE c.parent_id = ? AND a.deleted_at IS NULL ORDER BY a.created_at DESC`
      )
      .all(req.user.id);
  } else {
    return res.status(403).json({ error: 'Not available for this role' });
  }
  res.json({ assignments: rows });
}

/**
 * PATCH /api/assignments/:id/submit  (child, or parent submitting on their behalf)
 * body: { content?, file_url? }
 */
async function submit(req, res) {
  const { id } = req.params;
  const { content, file_url } = req.body || {};
  if (!content && !file_url) return res.status(400).json({ error: 'content or file_url is required' });

  const assignment = await db.prepare('SELECT * FROM assignments WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  if (assignment.status === 'graded') return res.status(400).json({ error: 'This assignment has already been graded' });

  const child = assignment.child_id
    ? await db.prepare('SELECT user_id, parent_id FROM children WHERE id = ?').get(assignment.child_id)
    : null;
  const isChildOwner = !!child && req.user.role === 'child' && child.user_id === req.user.id;
  const isParentOwner = !!child && req.user.role === 'parent' && child.parent_id === req.user.id;
  const isStudentOwner = !child && req.user.role === 'adult_student' && assignment.student_user_id === req.user.id;
  if (!isChildOwner && !isParentOwner && !isStudentOwner) return res.status(403).json({ error: 'Not authorized to submit this assignment' });

  const ts = now();
  await db.prepare(
    `UPDATE assignments SET status = 'submitted', submission_content = ?, submission_file_url = ?, submitted_at = ?, submitted_by_user_id = ?, updated_at = ? WHERE id = ?`
  ).run(content || null, file_url || null, ts, req.user.id, ts, id);

  if (assignment.child_id) await recordActivity(assignment.child_id, 10);

  const [tutorRecipient, submitter] = await Promise.all([
    db.prepare('SELECT * FROM users WHERE id = ?').get(assignment.tutor_id),
    db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id),
  ]);
  const studentName = child ? (await db.prepare('SELECT full_name FROM children WHERE id = ?').get(assignment.child_id))?.full_name : submitter?.full_name;
  if (tutorRecipient) await notifyUser(tutorRecipient, templates.assignmentSubmitted(studentName || 'Your student', assignment.title));

  res.json({ assignment: await db.prepare('SELECT * FROM assignments WHERE id = ?').get(id) });
}

/**
 * PATCH /api/assignments/:id/grade  (tutor, owner only)
 * body: { grade, feedback? }
 */
async function grade(req, res) {
  const { id } = req.params;
  const { grade: gradeValue, feedback } = req.body || {};
  if (!gradeValue) return res.status(400).json({ error: 'grade is required' });

  const assignment = await db.prepare('SELECT * FROM assignments WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  if (assignment.tutor_id !== req.user.id) return res.status(403).json({ error: 'Not your assignment' });
  if (assignment.status !== 'submitted') return res.status(400).json({ error: 'Only a submitted assignment can be graded' });

  const ts = now();
  await db.prepare(
    `UPDATE assignments SET status = 'graded', grade = ?, feedback = ?, graded_at = ?, updated_at = ? WHERE id = ?`
  ).run(gradeValue, feedback || null, ts, ts, id);

  const tutorUser = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id);
  const child = assignment.child_id ? await db.prepare('SELECT parent_id FROM children WHERE id = ?').get(assignment.child_id) : null;
  const recipient = await db.prepare('SELECT * FROM users WHERE id = ?').get(child ? child.parent_id : assignment.student_user_id);
  await notifyUser(recipient, templates.assignmentGraded(tutorUser.full_name, assignment.title, gradeValue));

  res.json({ assignment: await db.prepare('SELECT * FROM assignments WHERE id = ?').get(id) });
}

module.exports = { create, listMine, submit, grade };
