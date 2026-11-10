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

/** POST /api/children  body: { full_name, grade_level } */
async function create(req, res) {
  const { full_name, grade_level } = req.body || {};
  if (!full_name) return res.status(400).json({ error: 'full_name is required' });

  const id = uuidv4();
  const ts = now();
  await db.prepare(
    `INSERT INTO children (id, parent_id, school_id, full_name, grade_level, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?)`
  ).run(id, req.user.id, full_name, grade_level || null, ts, ts);

  res.status(201).json({ child: await db.prepare('SELECT * FROM children WHERE id = ?').get(id) });
}

/** PATCH /api/children/:id  body: { full_name?, grade_level? } */
async function update(req, res) {
  const { id } = req.params;
  const child = await db.prepare('SELECT * FROM children WHERE id = ? AND parent_id = ? AND deleted_at IS NULL').get(id, req.user.id);
  if (!child) return res.status(404).json({ error: 'Child not found' });

  const full_name = req.body?.full_name ?? child.full_name;
  const grade_level = req.body?.grade_level ?? child.grade_level;

  await db.prepare('UPDATE children SET full_name = ?, grade_level = ?, updated_at = ? WHERE id = ?')
    .run(full_name, grade_level, now(), id);

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
