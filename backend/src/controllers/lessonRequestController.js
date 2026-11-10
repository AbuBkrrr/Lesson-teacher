const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');
const { notifyUser, templates } = require('../services/notifications');

function now() {
  return new Date().toISOString();
}

/** POST /api/lesson-requests  (parent or adult_student) */
async function create(req, res) {
  if (!['parent', 'adult_student'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only parents or adult students can post a lesson request' });
  }

  const { title, description, skill_id, grade_level, min_budget, max_budget, currency, city, online, child_id } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });

  if (req.user.role === 'adult_student' && child_id) {
    return res.status(400).json({ error: 'Adult students post requests for themselves and cannot set a child_id' });
  }
  if (child_id) {
    const child = await db.prepare('SELECT id FROM children WHERE id = ? AND parent_id = ?').get(child_id, req.user.id);
    if (!child) return res.status(400).json({ error: 'child_id does not match one of your children' });
  }
  if (skill_id) {
    const skill = await db.prepare('SELECT id FROM skills WHERE id = ? AND deleted_at IS NULL').get(skill_id);
    if (!skill) return res.status(400).json({ error: 'skill_id does not match a known skill' });
  }

  const id = uuidv4();
  const ts = now();
  await db.prepare(
    `INSERT INTO lesson_requests
       (id, requester_id, child_id, title, description, skill_id, grade_level, min_budget, max_budget, currency, city, online, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
  ).run(
    id, req.user.id, child_id || null, title, description || null, skill_id || null, grade_level || null,
    min_budget ?? null, max_budget ?? null, currency || 'NGN', city || null, online === false ? 0 : 1, ts, ts
  );

  res.status(201).json({ lesson_request: await db.prepare('SELECT * FROM lesson_requests WHERE id = ?').get(id) });
}

/** GET /api/lesson-requests/open?skill_id=&city=&online=  (tutor — browse open requests) */
async function listOpen(req, res) {
  const { skill_id, city, online } = req.query;
  const conditions = ["lr.status = 'open'", 'lr.deleted_at IS NULL'];
  const params = {};
  if (skill_id) { conditions.push('lr.skill_id = @skill_id'); params.skill_id = skill_id; }
  if (city) { conditions.push('lr.city ILIKE @city'); params.city = `%${city}%`; }
  if (online === 'true') conditions.push('lr.online = 1');
  else if (online === 'false') conditions.push('lr.online = 0');

  const rows = await db.prepare(
    `SELECT lr.*, s.name AS skill_name, u.full_name AS requester_name
     FROM lesson_requests lr
     LEFT JOIN skills s ON s.id = lr.skill_id
     JOIN users u ON u.id = lr.requester_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY lr.created_at DESC LIMIT 100`
  ).all(params);
  res.json({ lesson_requests: rows });
}

/** GET /api/lesson-requests/mine  (parent or adult_student — their own posted requests, with applications) */
async function listMine(req, res) {
  if (!['parent', 'adult_student'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only parents or adult students have posted requests to list here' });
  }
  const requests = await db
    .prepare('SELECT * FROM lesson_requests WHERE requester_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
    .all(req.user.id);

  if (requests.length > 0) {
    const ids = requests.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const apps = await db.prepare(
      `SELECT a.*, u.full_name AS tutor_name FROM lesson_request_applications a
       JOIN users u ON u.id = a.tutor_id WHERE a.request_id IN (${placeholders}) ORDER BY a.created_at ASC`
    ).all(...ids);
    const byRequest = {};
    apps.forEach((a) => { (byRequest[a.request_id] ||= []).push(a); });
    requests.forEach((r) => { r.applications = byRequest[r.id] || []; });
  }

  res.json({ lesson_requests: requests });
}

/** PATCH /api/lesson-requests/:id/close  (requester) */
async function close(req, res) {
  const request = await db.prepare('SELECT * FROM lesson_requests WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Lesson request not found' });
  if (request.requester_id !== req.user.id) return res.status(403).json({ error: 'Not your lesson request' });

  await db.prepare("UPDATE lesson_requests SET status = 'closed', updated_at = ? WHERE id = ?").run(now(), request.id);
  res.json({ lesson_request: await db.prepare('SELECT * FROM lesson_requests WHERE id = ?').get(request.id) });
}

/** POST /api/lesson-requests/:id/apply  (tutor)  body: { message, proposed_rate } */
async function apply(req, res) {
  if (req.user.role !== 'tutor') return res.status(403).json({ error: 'Only tutors can apply to a lesson request' });

  const request = await db.prepare("SELECT * FROM lesson_requests WHERE id = ? AND deleted_at IS NULL AND status = 'open'").get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Open lesson request not found' });

  const { message, proposed_rate } = req.body || {};
  const existing = await db.prepare('SELECT id FROM lesson_request_applications WHERE request_id = ? AND tutor_id = ?').get(request.id, req.user.id);
  if (existing) return res.status(409).json({ error: 'You already applied to this request' });

  const id = uuidv4();
  const ts = now();
  await db.prepare(
    `INSERT INTO lesson_request_applications (id, request_id, tutor_id, message, proposed_rate, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(id, request.id, req.user.id, message || null, proposed_rate ?? null, ts, ts);

  const [requester, tutor] = await Promise.all([
    db.prepare('SELECT * FROM users WHERE id = ?').get(request.requester_id),
    db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id),
  ]);
  await notifyUser(requester, templates.bookingRequested(tutor.full_name, request.title));

  res.status(201).json({ application: await db.prepare('SELECT * FROM lesson_request_applications WHERE id = ?').get(id) });
}

/** GET /api/lesson-requests/applications/mine  (tutor — their own applications) */
async function myApplications(req, res) {
  if (req.user.role !== 'tutor') return res.status(403).json({ error: 'Only tutors have applications to list here' });
  const rows = await db.prepare(
    `SELECT a.*, lr.title, lr.status AS request_status FROM lesson_request_applications a
     JOIN lesson_requests lr ON lr.id = a.request_id WHERE a.tutor_id = ? ORDER BY a.created_at DESC`
  ).all(req.user.id);
  res.json({ applications: rows });
}

/**
 * POST /api/lesson-requests/:id/applications/:appId/accept  (requester)
 * Accepting auto-creates a normal booking, reusing the existing
 * booking/payment flow rather than a separate manual booking step.
 */
async function acceptApplication(req, res) {
  const request = await db.prepare('SELECT * FROM lesson_requests WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Lesson request not found' });
  if (request.requester_id !== req.user.id) return res.status(403).json({ error: 'Not your lesson request' });

  const application = await db.prepare(
    "SELECT * FROM lesson_request_applications WHERE id = ? AND request_id = ? AND status = 'pending'"
  ).get(req.params.appId, request.id);
  if (!application) return res.status(404).json({ error: 'Pending application not found' });

  const bookingId = require('../utils/referral').uuidv4();
  const ts = now();

  await db.prepare(
    `INSERT INTO bookings (id, parent_id, tutor_id, child_id, subject, scheduled_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'pending', ?, ?)`
  ).run(bookingId, request.requester_id, application.tutor_id, request.child_id || null, request.title, ts, ts);

  await db.prepare("UPDATE lesson_request_applications SET status = 'accepted', booking_id = ?, updated_at = ? WHERE id = ?")
    .run(bookingId, ts, application.id);
  const rivalApplications = await db.prepare(
    "SELECT tutor_id FROM lesson_request_applications WHERE request_id = ? AND id != ? AND status = 'pending'"
  ).all(request.id, application.id);
  await db.prepare("UPDATE lesson_requests SET status = 'closed', updated_at = ? WHERE id = ?").run(ts, request.id);
  await db.prepare("UPDATE lesson_request_applications SET status = 'declined', updated_at = ? WHERE request_id = ? AND id != ? AND status = 'pending'")
    .run(ts, request.id, application.id);

  const [tutorUser, requesterUser] = await Promise.all([
    db.prepare('SELECT * FROM users WHERE id = ?').get(application.tutor_id),
    db.prepare('SELECT full_name FROM users WHERE id = ?').get(request.requester_id),
  ]);
  await notifyUser(tutorUser, templates.applicationAccepted(requesterUser.full_name, request.title));
  await Promise.all(rivalApplications.map(async (rival) => {
    const rivalUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(rival.tutor_id);
    if (rivalUser) await notifyUser(rivalUser, templates.applicationDeclined(request.title));
  }));

  res.json({
    application: await db.prepare('SELECT * FROM lesson_request_applications WHERE id = ?').get(application.id),
    booking: await db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId),
  });
}

/** POST /api/lesson-requests/:id/applications/:appId/decline  (requester) */
async function declineApplication(req, res) {
  const request = await db.prepare('SELECT * FROM lesson_requests WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Lesson request not found' });
  if (request.requester_id !== req.user.id) return res.status(403).json({ error: 'Not your lesson request' });

  const application = await db.prepare(
    "SELECT * FROM lesson_request_applications WHERE id = ? AND request_id = ? AND status = 'pending'"
  ).get(req.params.appId, request.id);
  if (!application) return res.status(404).json({ error: 'Pending application not found' });

  await db.prepare("UPDATE lesson_request_applications SET status = 'declined', updated_at = ? WHERE id = ?").run(now(), application.id);

  const tutorUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(application.tutor_id);
  if (tutorUser) await notifyUser(tutorUser, templates.applicationDeclined(request.title));

  res.json({ application: await db.prepare('SELECT * FROM lesson_request_applications WHERE id = ?').get(application.id) });
}

module.exports = { create, listOpen, listMine, close, apply, myApplications, acceptApplication, declineApplication };
