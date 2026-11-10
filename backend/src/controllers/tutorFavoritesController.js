const { publicTutorProfile } = require('../utils/tutorPublic');
const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');

function now() {
  return new Date().toISOString();
}

/** POST /api/tutors/:id/favorite */
async function add(req, res) {
  const tutorId = req.params.id;
  const tutor = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'tutor' AND deleted_at IS NULL").get(tutorId);
  if (!tutor) return res.status(404).json({ error: 'Tutor not found' });

  const existing = await db.prepare('SELECT id FROM tutor_favorites WHERE parent_id = ? AND tutor_id = ?').get(req.user.id, tutorId);
  if (!existing) {
    await db.prepare('INSERT INTO tutor_favorites (id, parent_id, tutor_id, created_at) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), req.user.id, tutorId, now());
  }
  res.status(201).json({ ok: true });
}

/** DELETE /api/tutors/:id/favorite */
async function remove(req, res) {
  await db.prepare('DELETE FROM tutor_favorites WHERE parent_id = ? AND tutor_id = ?').run(req.user.id, req.params.id);
  res.json({ ok: true });
}

/** GET /api/tutors/favorites/mine — this parent's saved tutors, same card shape as the main tutor list */
async function listMine(req, res) {
  const rows = await db.prepare(
    `SELECT tp.*, u.full_name, u.school_id, f.created_at AS favorited_at
     FROM tutor_favorites f
     JOIN tutor_profiles tp ON tp.user_id = f.tutor_id
     JOIN users u ON u.id = f.tutor_id AND u.deleted_at IS NULL
     WHERE f.parent_id = ?
     ORDER BY f.created_at DESC`
  ).all(req.user.id);

  const tutors = rows.map((r) => {
    let subjects = [];
    try { subjects = JSON.parse(r.subjects || '[]'); } catch { /* ignore */ }
    return { ...publicTutorProfile(r), subjects };
  });

  res.json({ tutors });
}

module.exports = { add, remove, listMine };
