const db = require('../config/db');
const { getPaging, pageMeta } = require('../utils/paging');
const { uuidv4 } = require('../utils/referral');
const { notifyUser, templates } = require('../services/notifications');
const { normalizeScheduledAt } = require('../utils/schedule');

function now() {
  return new Date().toISOString();
}

/**
 * Audition types:
 *  - video:     tutor records a short sample lesson and shares the link
 *  - live:      a short live session at an agreed time (link optional)
 *  - portfolio: tutor shares a portfolio / past work link
 *  - challenge: parent sets a task in `brief`, tutor submits a link to their answer
 */
const TYPES = ['video', 'live', 'portfolio', 'challenge'];

// Status flow: pending -> ready (tutor submitted) -> completed (parent reviewed)
//              pending -> declined (tutor can't do it)
const VALID_TRANSITIONS = {
  tutor: { pending: ['ready', 'declined'], ready: ['completed'] },
  super_admin: { pending: ['ready', 'declined'], ready: ['completed'] },
};

const SELECT_FULL = `SELECT a.*, ut.full_name AS tutor_name, up.full_name AS parent_name,
                            c.full_name AS child_name, s.name AS skill_name
                       FROM auditions a
                       JOIN users ut ON ut.id = a.tutor_id
                       JOIN users up ON up.id = a.parent_id
                       LEFT JOIN children c ON c.id = a.child_id
                       LEFT JOIN skills s ON s.id = a.skill_id`;

async function loadFull(id) {
  return db.prepare(`${SELECT_FULL} WHERE a.id = ?`).get(id);
}

/** POST /api/auditions  (parent / adult_student)  body: { tutor_id, type?, child_id?, skill_id?, brief? } */
async function create(req, res) {
  if (!['parent', 'adult_student'].includes(req.user.role)) return res.status(403).json({ error: 'Only parents and adult students can request an audition' });

  const { tutor_id, child_id, skill_id } = req.body || {};
  const type = (req.body?.type || 'video').toString();
  const brief = typeof req.body?.brief === 'string' ? req.body.brief.trim() : '';

  const tutor = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'tutor' AND deleted_at IS NULL").get(tutor_id);
  if (!tutor) return res.status(400).json({ error: 'tutor_id does not match a known tutor' });
  if (!TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${TYPES.join(', ')}` });
  if (type === 'challenge' && !brief) return res.status(400).json({ error: 'A challenge audition needs a brief describing the task' });
  if (brief.length > 2000) return res.status(400).json({ error: 'brief must be at most 2000 characters' });

  if (child_id) {
    if (req.user.role !== 'parent') return res.status(400).json({ error: 'Adult students audition for themselves and cannot set a child_id' });
    const child = await db.prepare('SELECT id FROM children WHERE id = ? AND parent_id = ? AND deleted_at IS NULL').get(child_id, req.user.id);
    if (!child) return res.status(400).json({ error: 'child_id does not match one of your children' });
  }
  if (skill_id) {
    const skill = await db.prepare('SELECT id FROM skills WHERE id = ? AND deleted_at IS NULL').get(skill_id);
    if (!skill) return res.status(400).json({ error: 'skill_id does not match a skill in the catalog' });
  }

  const id = uuidv4();
  const ts = now();
  await db.prepare(
    `INSERT INTO auditions (id, parent_id, tutor_id, child_id, skill_id, type, brief, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(id, req.user.id, tutor_id, child_id || null, skill_id || null, type, brief || null, ts, ts);

  const parent = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id);
  await notifyUser(tutor, templates.auditionRequested(parent.full_name, type));

  res.status(201).json({ audition: await loadFull(id) });
}

/** GET /api/auditions/mine */
async function listMine(req, res) {
  let rows;
  let paging = null;
  let total = 0;
  if (['parent', 'adult_student'].includes(req.user.role)) {
    rows = await db.prepare(`${SELECT_FULL} WHERE a.parent_id = ? AND a.deleted_at IS NULL ORDER BY a.created_at DESC`).all(req.user.id);
  } else if (req.user.role === 'tutor') {
    rows = await db.prepare(`${SELECT_FULL} WHERE a.tutor_id = ? AND a.deleted_at IS NULL ORDER BY a.created_at DESC`).all(req.user.id);
  } else if (req.user.role === 'super_admin') {
    paging = getPaging(req);
    total = (await db.prepare('SELECT COUNT(*) AS count FROM auditions WHERE deleted_at IS NULL').get()).count;
    rows = await db.prepare(`${SELECT_FULL} WHERE a.deleted_at IS NULL ORDER BY a.created_at DESC, a.id LIMIT ? OFFSET ?`).all(paging.limit, paging.offset);
  } else {
    return res.status(403).json({ error: 'Not available for this role' });
  }
  res.json({ auditions: rows, ...(paging ? pageMeta(paging, total) : {}) });
}

/** PATCH /api/auditions/:id/status  (tutor)  body: { status, video_url?, scheduled_at?, tutor_note? } */
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

  let scheduledAt = audition.scheduled_at;
  if (video_url && !/^https?:\/\//i.test(video_url)) {
    return res.status(400).json({ error: 'The link must start with https:// or http://' });
  }
  if (status === 'ready') {
    const url = video_url || audition.video_url;
    if (audition.type === 'live') {
      const sched = normalizeScheduledAt(req.body?.scheduled_at || audition.scheduled_at);
      if (sched.error) return res.status(400).json({ error: sched.error });
      if (!sched.iso) return res.status(400).json({ error: 'A live audition needs a scheduled_at time' });
      scheduledAt = sched.iso;
    } else if (!url) {
      const what = audition.type === 'portfolio' ? 'portfolio link' : audition.type === 'challenge' ? 'link to your challenge answer' : 'video link';
      return res.status(400).json({ error: `A ${what} (https://…) is required to mark an audition ready` });
    }
  }

  const note = typeof req.body?.tutor_note === 'string' ? req.body.tutor_note.trim().slice(0, 2000) : null;
  await db.prepare(
    `UPDATE auditions SET status = ?, video_url = COALESCE(?, video_url), scheduled_at = ?,
            tutor_note = COALESCE(?, tutor_note), updated_at = ? WHERE id = ?`
  ).run(status, video_url || null, scheduledAt || null, note || null, now(), id);

  if (status === 'ready' || status === 'declined') {
    const parentUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(audition.parent_id);
    if (parentUser) {
      await notifyUser(parentUser, status === 'ready' ? templates.auditionReady() : templates.auditionDeclined());
    }
  }

  res.json({ audition: await loadFull(id) });
}

/**
 * PATCH /api/auditions/:id/review  (the requesting parent / adult student)
 * body: { rating: 1..5, feedback?, decision: 'accepted' | 'rejected' }
 * Allowed once the tutor has submitted (ready) — and can be revised while
 * the audition is completed. Reviewing completes the audition.
 */
async function review(req, res) {
  const audition = await db.prepare('SELECT * FROM auditions WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!audition) return res.status(404).json({ error: 'Audition not found' });
  if (audition.parent_id !== req.user.id) return res.status(403).json({ error: 'Not your audition' });
  if (!['ready', 'completed'].includes(audition.status)) {
    return res.status(400).json({ error: 'You can review an audition once the tutor has submitted it' });
  }

  const { decision } = req.body || {};
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'rating must be a whole number from 1 to 5' });
  if (!['accepted', 'rejected'].includes(decision)) return res.status(400).json({ error: "decision must be 'accepted' or 'rejected'" });
  const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback.trim() : '';
  if (feedback.length > 2000) return res.status(400).json({ error: 'feedback must be at most 2000 characters' });

  const ts = now();
  await db.prepare(
    `UPDATE auditions SET status = 'completed', rating = ?, feedback = ?, decision = ?, decided_at = ?, updated_at = ? WHERE id = ?`
  ).run(rating, feedback || null, decision, ts, ts, audition.id);

  const [tutorUser, parent] = await Promise.all([
    db.prepare('SELECT * FROM users WHERE id = ?').get(audition.tutor_id),
    db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id),
  ]);
  if (tutorUser) await notifyUser(tutorUser, templates.auditionReviewed(parent.full_name, decision));

  res.json({ audition: await loadFull(audition.id) });
}

module.exports = { create, listMine, updateStatus, review, TYPES };
