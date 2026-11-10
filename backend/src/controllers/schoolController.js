const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');

function now() {
  return new Date().toISOString();
}

/**
 * GET /api/schools/me/parent-lookup?identifier=email-or-phone
 * Also returns the parent's existing children (regardless of which school,
 * if any, they're currently linked to) — without this, a school admin has
 * no way to tell a child the parent already added themselves apart from
 * one that doesn't exist yet, and ends up creating a second, disconnected
 * record for the same real student instead of linking the one that exists.
 */
async function lookupParent(req, res) {
  const { identifier } = req.query;
  if (!identifier) return res.status(400).json({ error: 'identifier query param is required' });

  const parent = await db
    .prepare("SELECT id, full_name, email, phone FROM users WHERE role = 'parent' AND (email = ? OR phone = ?) AND deleted_at IS NULL")
    .get(identifier, identifier);

  if (!parent) return res.status(404).json({ error: 'No parent account matches that email or phone' });

  const children = await db
    .prepare('SELECT id, full_name, grade_level, school_id FROM children WHERE parent_id = ? AND deleted_at IS NULL ORDER BY full_name')
    .all(parent.id);

  res.json({ parent, children });
}

/** GET /api/schools/me  (school_admin) */
async function mySchool(req, res) {
  const school = await db.prepare('SELECT * FROM schools WHERE id = ? AND deleted_at IS NULL').get(req.user.school_id);
  if (!school) return res.status(404).json({ error: 'No school associated with this account' });
  res.json({ school });
}

/** PATCH /api/schools/me */
async function updateMySchool(req, res) {
  const school = await db.prepare('SELECT * FROM schools WHERE id = ? AND deleted_at IS NULL').get(req.user.school_id);
  if (!school) return res.status(404).json({ error: 'No school associated with this account' });

  const name = req.body?.name ?? school.name;
  const address = req.body?.address ?? school.address;
  const contact_email = req.body?.contact_email ?? school.contact_email;
  const contact_phone = req.body?.contact_phone ?? school.contact_phone;

  await db.prepare(
    'UPDATE schools SET name = ?, address = ?, contact_email = ?, contact_phone = ?, updated_at = ? WHERE id = ?'
  ).run(name, address, contact_email, contact_phone, now(), req.user.school_id);

  res.json({ school: await db.prepare('SELECT * FROM schools WHERE id = ?').get(req.user.school_id) });
}

/** GET /api/schools/me/children  (school_admin) */
async function myChildren(req, res) {
  const rows = await db
    .prepare('SELECT * FROM children WHERE school_id = ? AND deleted_at IS NULL ORDER BY full_name')
    .all(req.user.school_id);
  res.json({ children: rows });
}

/**
 * POST /api/schools/me/children  (school_admin)
 * body: either { child_id } to link a child the parent already created
 * themselves, or { parent_id, full_name, grade_level } to create a new one
 * (for a child that doesn't exist in the system yet). Linking is preferred
 * whenever the child already exists — see lookupParent, which now returns
 * the parent's existing children for exactly this reason.
 */
async function addChild(req, res) {
  const { child_id, parent_id, full_name, grade_level } = req.body || {};

  if (child_id) {
    const child = await db.prepare('SELECT * FROM children WHERE id = ? AND deleted_at IS NULL').get(child_id);
    if (!child) return res.status(404).json({ error: 'Child not found' });
    if (child.school_id && child.school_id !== req.user.school_id) {
      return res.status(400).json({ error: 'This child is already linked to a different school' });
    }
    await db.prepare('UPDATE children SET school_id = ?, updated_at = ? WHERE id = ?').run(req.user.school_id, now(), child_id);
    return res.json({ child: await db.prepare('SELECT * FROM children WHERE id = ?').get(child_id) });
  }

  if (!parent_id || !full_name) {
    return res.status(400).json({ error: 'Either child_id, or both parent_id and full_name, are required' });
  }

  const parent = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'parent' AND deleted_at IS NULL").get(parent_id);
  if (!parent) return res.status(400).json({ error: 'parent_id does not match a known parent account' });

  const id = uuidv4();
  const ts = now();
  await db.prepare(
    `INSERT INTO children (id, parent_id, school_id, full_name, grade_level, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, parent_id, req.user.school_id, full_name, grade_level || null, ts, ts);

  res.status(201).json({ child: await db.prepare('SELECT * FROM children WHERE id = ?').get(id) });
}

module.exports = { mySchool, updateMySchool, myChildren, addChild, lookupParent };
