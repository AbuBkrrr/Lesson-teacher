const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');

function now() {
  return new Date().toISOString();
}

/** GET /api/children/mine */
async function listMine(req, res) {
  const rows = await db
    .prepare('SELECT * FROM children WHERE parent_id = ? AND deleted_at IS NULL ORDER BY full_name')
    .all(req.user.id);
  res.json({ children: rows });
}

/** Validates optional profile fields. Returns { error } or { values } with only the keys that were sent. */
function readProfileFields(body) {
  const values = {};
  if (body.age !== undefined) {
    if (body.age === null || body.age === '') values.age = null;
    else {
      const age = Number(body.age);
      if (!Number.isInteger(age) || age < 1 || age > 25) return { error: 'age must be a whole number from 1 to 25' };
      values.age = age;
    }
  }
  for (const [key, max] of [['school_name', 200], ['learning_needs', 2000], ['grade_level', 50]]) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && typeof body[key] !== 'string') return { error: `${key} must be text` };
    const v = body[key] === null ? null : body[key].trim();
    if (v && v.length > max) return { error: `${key} must be at most ${max} characters` };
    values[key] = v || null;
  }
  return { values };
}

/** POST /api/children  body: { full_name, grade_level?, age?, school_name?, learning_needs? } */
async function create(req, res) {
  const body = req.body || {};
  const full_name = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  if (!full_name) return res.status(400).json({ error: 'full_name is required' });
  const fields = readProfileFields(body);
  if (fields.error) return res.status(400).json({ error: fields.error });
  const v = fields.values;

  const id = uuidv4();
  const ts = now();
  await db.prepare(
    `INSERT INTO children (id, parent_id, school_id, full_name, grade_level, age, school_name, learning_needs, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.user.id, full_name, v.grade_level ?? null, v.age ?? null, v.school_name ?? null, v.learning_needs ?? null, ts, ts);

  res.status(201).json({ child: await db.prepare('SELECT * FROM children WHERE id = ?').get(id) });
}

/** PATCH /api/children/:id  body: { full_name?, grade_level?, age?, school_name?, learning_needs? } */
async function update(req, res) {
  const { id } = req.params;
  const child = await db.prepare('SELECT * FROM children WHERE id = ? AND parent_id = ? AND deleted_at IS NULL').get(id, req.user.id);
  if (!child) return res.status(404).json({ error: 'Child not found' });

  const body = req.body || {};
  const fields = readProfileFields(body);
  if (fields.error) return res.status(400).json({ error: fields.error });
  const merged = { grade_level: child.grade_level, age: child.age, school_name: child.school_name, learning_needs: child.learning_needs, ...fields.values };
  const full_name = typeof body.full_name === 'string' && body.full_name.trim() ? body.full_name.trim() : child.full_name;

  await db.prepare('UPDATE children SET full_name = ?, grade_level = ?, age = ?, school_name = ?, learning_needs = ?, updated_at = ? WHERE id = ?')
    .run(full_name, merged.grade_level, merged.age, merged.school_name, merged.learning_needs, now(), id);

  res.json({ child: await db.prepare('SELECT * FROM children WHERE id = ?').get(id) });
}

/** DELETE /api/children/:id */
async function remove(req, res) {
  const { id } = req.params;
  const result = await db
    .prepare('UPDATE children SET deleted_at = ?, updated_at = ? WHERE id = ? AND parent_id = ?')
    .run(now(), now(), id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Child not found' });
  res.json({ ok: true });
}

/** GET /api/children/me — lets a signed-in child discover their own child_id (parent-created rows have no other way for the child to find it). */
async function myRecord(req, res) {
  const child = await db.prepare('SELECT * FROM children WHERE user_id = ? AND deleted_at IS NULL').get(req.user.id);
  if (!child) return res.status(404).json({ error: 'No linked child record found' });
  res.json({ child });
}

module.exports = { listMine, create, update, remove, myRecord };
