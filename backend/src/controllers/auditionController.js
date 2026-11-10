const db = require('../config/db');
const { getPaging, pageMeta } = require('../utils/paging');
const { uuidv4 } = require('../utils/referral');
const { notifyUser, templates } = require('../services/notifications');

function now() {
  return new Date().toISOString();
}

const VALID_TRANSITIONS = {
  tutor: { pending: ['ready', 'declined'], ready: ['completed'] },
  super_admin: { pending: ['ready', 'declined'], ready: ['completed'] },
};

/** POST /api/auditions  (parent)  body: { tutor_id } */
async function create(req, res) {
  if (!['parent', 'adult_student'].includes(req.user.role)) return res.status(403).json({ error: 'Only parents and adult students can request an audition' });

  const { tutor_id } = req.body || {};
  const tutor = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'tutor' AND deleted_at IS NULL").get(tutor_id);
  if (!tutor) return res.status(400).json({ error: 'tutor_id does not match a known tutor' });

  const id = uuidv4();
  const ts = now();
  await db.prepare(
    `INSERT INTO auditions (id, parent_id, tutor_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)`
  ).run(id, req.user.id, tutor_id, ts, ts);

  res.status(201).json({ audition: await db.prepare('SELECT * FROM auditions WHERE id = ?').get(id) });
}

/** GET /api/auditions/mine */
async function listMine(req, res) {
  let rows;
  let paging = null;
  let total = 0;
  if (['parent', 'adult_student'].includes(req.user.role)) {
    rows = await db
      .prepare(
        `SELECT a.*, u.full_name AS tutor_name FROM auditions a JOIN users u ON u.id = a.tutor_id
         WHERE a.parent_id = ? AND a.deleted_at IS NULL ORDER BY a.created_at DESC`
      )
      .all(req.user.id);
  } else if (req.user.role === 'tutor') {
    rows = await db
      .prepare(
        `SELECT a.*, u.full_name AS parent_name FROM auditions a JOIN users u ON u.id = a.parent_id
         WHERE a.tutor_id = ? AND a.deleted_at IS NULL ORDER BY a.created_at DESC`
      )
      .all(req.user.id);
  } else if (req.user.role === 'super_admin') {
    paging = getPaging(req);
    total = (await db.prepare('SELECT COUNT(*) AS count FROM auditions WHERE deleted_at IS NULL').get()).count;
    rows = await db.prepare('SELECT * FROM auditions WHERE deleted_at IS NULL ORDER BY created_at DESC, id LIMIT ? OFFSET ?').all(paging.limit, paging.offset);
  } else {
    return res.status(403).json({ error: 'Not available for this role' });
  }
  res.json({ auditions: rows, ...(paging ? pageMeta(paging, total) : {}) });
}

/** PATCH /api/auditions/:id/status  body: { status, video_url? } */
async function updateStatus(req, res) {
  const { id } = req.params;
  const { status, video_url } = req.body || {};
  const audition = await db.prepare('SELECT * FROM auditions WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!audition) return res.status(404).json({ error: 'Audition not found' });

  const isOwner = (req.user.role === 'tutor' && audition.tutor_id === req.user.id) || req.user.role === 'super_admin';
  if (!isOwner) return res.status(403).json({ error: 'Not your audition' });

  const allowedNext = VALID_TRANSITIONS[req.user.role]?.[audition.status] || [];
  if (!allowedNext.includes(status)) {
    return res.status(400).json({ error: `Cannot move audition from ${audition.status} to ${status}` });
  }

  if (status === 'ready') {
    const url = video_url || audition.video_url;
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'A video link (https://…) is required to mark an audition ready' });
    }
  }

  await db.prepare('UPDATE auditions SET status = ?, video_url = COALESCE(?, video_url), updated_at = ? WHERE id = ?')
    .run(status, video_url || null, now(), id);

  if (status === 'ready' || status === 'declined') {
    const parentUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(audition.parent_id);
    if (parentUser) {
      await notifyUser(parentUser, status === 'ready' ? templates.auditionReady() : templates.auditionDeclined());
    }
  }

  res.json({ audition: await db.prepare('SELECT * FROM auditions WHERE id = ?').get(id) });
}

module.exports = { create, listMine, updateStatus };
