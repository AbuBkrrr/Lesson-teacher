const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');

function now() {
  return new Date().toISOString();
}

/**
 * GET /api/curriculum?skill_id=&grade_level=
 * Visibility rules:
 *   - super_admin: everything
 *   - school_admin: global units + their own school's units
 *   - everyone else (parent/tutor/child): global units, plus units
 *     from any school they're actually connected to (a parent/child
 *     whose account is attached to that school, or a tutor with a
 *     confirmed/completed booking with a child from that school)
 */
async function list(req, res) {
  const { skill_id, grade_level } = req.query;
  const conditions = ['cu.deleted_at IS NULL'];
  const params = {};

  if (skill_id) { conditions.push('cu.skill_id = @skill_id'); params.skill_id = skill_id; }
  if (grade_level) { conditions.push('cu.grade_level = @grade_level'); params.grade_level = grade_level; }

  let visibilityClause;
  if (req.user.role === 'super_admin') {
    visibilityClause = '1=1';
  } else if (req.user.role === 'school_admin') {
    visibilityClause = '(cu.school_id IS NULL OR cu.school_id = @callerSchoolId)';
    params.callerSchoolId = req.user.school_id;
  } else if (req.user.role === 'tutor') {
    visibilityClause = `(cu.school_id IS NULL OR cu.school_id IN (
      SELECT DISTINCT c.school_id FROM bookings b JOIN children c ON c.id = b.child_id
      WHERE b.tutor_id = @callerId AND b.status IN ('confirmed','completed') AND c.school_id IS NOT NULL
    ))`;
    params.callerId = req.user.id;
  } else if (['parent', 'adult_student', 'child'].includes(req.user.role)) {
    const schoolId = req.user.role === 'child'
      ? (await db.prepare('SELECT school_id FROM children WHERE user_id = ?').get(req.user.id))?.school_id
      : null;
    const callerSchoolId = schoolId || req.user.school_id || null;
    visibilityClause = '(cu.school_id IS NULL OR cu.school_id = @callerSchoolId)';
    params.callerSchoolId = callerSchoolId;
  } else {
    visibilityClause = 'cu.school_id IS NULL';
  }

  conditions.push(visibilityClause);
  const where = conditions.join(' AND ');

  const rows = await db
    .prepare(
      `SELECT cu.*, s.name AS skill_name, sc.name AS school_name
       FROM curriculum_units cu
       LEFT JOIN skills s ON s.id = cu.skill_id
       LEFT JOIN schools sc ON sc.id = cu.school_id
       WHERE ${where}
       ORDER BY cu.grade_level, cu.title`
    )
    .all(params);

  res.json({ curriculum_units: rows });
}

/**
 * POST /api/curriculum  (super_admin: global; school_admin: their own school)
 * body: { title, description, skill_id, grade_level, school_id? }
 */
async function create(req, res) {
  const { title, description, skill_id, grade_level } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });

  let schoolId = null;
  if (req.user.role === 'school_admin') {
    schoolId = req.user.school_id;
  } else if (req.user.role === 'super_admin') {
    schoolId = req.body.school_id || null;
  } else {
    return res.status(403).json({ error: 'Only super_admin or school_admin can create curriculum units' });
  }

  const id = uuidv4();
  const ts = now();
  await db.prepare(
    `INSERT INTO curriculum_units (id, title, description, skill_id, grade_level, school_id, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, title, description || null, skill_id || null, grade_level || null, schoolId, req.user.id, ts, ts);

  res.status(201).json({ curriculum_unit: await db.prepare('SELECT * FROM curriculum_units WHERE id = ?').get(id) });
}

/** PATCH /api/curriculum/:id */
async function update(req, res) {
  const { id } = req.params;
  const unit = await db.prepare('SELECT * FROM curriculum_units WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!unit) return res.status(404).json({ error: 'Curriculum unit not found' });

  const isOwner = req.user.role === 'super_admin' || (req.user.role === 'school_admin' && unit.school_id === req.user.school_id);
  if (!isOwner) return res.status(403).json({ error: 'Not authorized to edit this curriculum unit' });

  const title = req.body?.title ?? unit.title;
  const description = req.body?.description ?? unit.description;
  const skillId = req.body?.skill_id ?? unit.skill_id;
  const gradeLevel = req.body?.grade_level ?? unit.grade_level;

  await db.prepare(
    'UPDATE curriculum_units SET title = ?, description = ?, skill_id = ?, grade_level = ?, updated_at = ? WHERE id = ?'
  ).run(title, description, skillId, gradeLevel, now(), id);

  res.json({ curriculum_unit: await db.prepare('SELECT * FROM curriculum_units WHERE id = ?').get(id) });
}

/** DELETE /api/curriculum/:id */
async function remove(req, res) {
  const { id } = req.params;
  const unit = await db.prepare('SELECT * FROM curriculum_units WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!unit) return res.status(404).json({ error: 'Curriculum unit not found' });

  const isOwner = req.user.role === 'super_admin' || (req.user.role === 'school_admin' && unit.school_id === req.user.school_id);
  if (!isOwner) return res.status(403).json({ error: 'Not authorized to delete this curriculum unit' });

  await db.prepare('UPDATE curriculum_units SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
  res.json({ ok: true });
}

module.exports = { list, create, update, remove };
