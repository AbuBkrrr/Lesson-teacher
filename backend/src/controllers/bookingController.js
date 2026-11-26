const db = require('../config/db');
const { getPaging, pageMeta } = require('../utils/paging');
const { uuidv4 } = require('../utils/referral');
const { notifyUser, templates } = require('../services/notifications');
const { recordActivity } = require('../services/gamification');
const { normalizeScheduledAt, withinAvailability, findConflict, LESSON_MINUTES, DURATIONS } = require('../utils/schedule');
const { recomputeProgress } = require('../services/progress');

function now() {
  return new Date().toISOString();
}

const VALID_TRANSITIONS = {
  parent: { pending: ['cancelled'], confirmed: ['cancelled'] },
  adult_student: { pending: ['cancelled'], confirmed: ['cancelled'] },
  tutor: { pending: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled'] },
  super_admin: { pending: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled'] },
};

const MAX_SERIES_WEEKS = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * POST /api/bookings  (parent or adult_student — an adult student books for themselves, so child_id is omitted)
 * body: { tutor_id, child_id?, skill_id?, subject?, scheduled_at?, duration_minutes?, notes?,
 *         recurrence?: { weeks: 2..12 } }
 * With `recurrence`, one booking per week is created at the same time (a series sharing
 * series_id). Every occurrence is checked against availability and clashes first, so
 * either the whole series is created or none of it.
 */
async function create(req, res) {
  if (req.user.role !== 'parent' && req.user.role !== 'adult_student') {
    return res.status(403).json({ error: 'Only parents or adult students can request a booking' });
  }

  const { tutor_id, child_id, skill_id, notes, recurrence } = req.body || {};
  let { subject } = req.body || {};
  if (!tutor_id) return res.status(400).json({ error: 'tutor_id is required' });

  const tutor = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'tutor' AND deleted_at IS NULL").get(tutor_id);
  if (!tutor) return res.status(400).json({ error: 'tutor_id does not match a known tutor' });

  if (req.user.role === 'adult_student' && child_id) {
    return res.status(400).json({ error: 'Adult students book for themselves and cannot set a child_id' });
  }

  if (child_id) {
    const child = await db.prepare('SELECT id FROM children WHERE id = ? AND parent_id = ? AND deleted_at IS NULL').get(child_id, req.user.id);
    if (!child) return res.status(400).json({ error: 'child_id does not match one of your children' });
  }

  if (skill_id) {
    const skill = await db.prepare('SELECT id, name FROM skills WHERE id = ? AND deleted_at IS NULL').get(skill_id);
    if (!skill) return res.status(400).json({ error: 'skill_id does not match a skill in the catalog' });
    if (!subject) subject = skill.name;
  }

  const duration = req.body?.duration_minutes === undefined || req.body?.duration_minutes === null
    ? LESSON_MINUTES
    : Number(req.body.duration_minutes);
  if (!DURATIONS.includes(duration)) {
    return res.status(400).json({ error: `duration_minutes must be one of: ${DURATIONS.join(', ')}` });
  }

  let weeks = 1;
  if (recurrence !== undefined && recurrence !== null) {
    weeks = Number(recurrence.weeks);
    if (!Number.isInteger(weeks) || weeks < 2 || weeks > MAX_SERIES_WEEKS) {
      return res.status(400).json({ error: `recurrence.weeks must be a whole number from 2 to ${MAX_SERIES_WEEKS}` });
    }
  }

  const sched = normalizeScheduledAt(req.body?.scheduled_at);
  if (sched.error) return res.status(400).json({ error: sched.error });
  if (weeks > 1 && !sched.iso) return res.status(400).json({ error: 'A recurring booking needs a scheduled_at for the first lesson' });

  const times = [];
  for (let i = 0; i < weeks; i++) {
    times.push(sched.iso ? new Date(new Date(sched.iso).getTime() + i * WEEK_MS).toISOString() : null);
  }
  for (const [i, iso] of times.entries()) {
    if (!iso) continue;
    const label = weeks > 1 ? ` (week ${i + 1}, ${iso.slice(0, 10)})` : '';
    if (!(await withinAvailability(tutor_id, iso, duration))) {
      return res.status(409).json({ error: `That time is outside the tutor's published availability${label} — pick a slot they offer.` });
    }
    if (await findConflict(tutor_id, iso, null, duration)) {
      return res.status(409).json({ error: `The tutor already has a lesson at that time${label} — pick another slot.` });
    }
  }

  // The price is fixed when the booking is made, so a later rate change
  // doesn't alter what the parent agreed to pay.
  const profile = await db.prepare('SELECT hourly_rate, currency FROM tutor_profiles WHERE user_id = ?').get(tutor_id);
  const price = profile?.hourly_rate ? Math.round(Number(profile.hourly_rate) * (duration / 60) * 100) / 100 : null;
  const currency = profile?.currency || 'NGN';

  const seriesId = weeks > 1 ? uuidv4() : null;
  const ts = now();
  const ids = [];
  await db.transaction(async () => {
    for (const iso of times) {
      const id = uuidv4();
      ids.push(id);
      await db.prepare(
        `INSERT INTO bookings (id, parent_id, tutor_id, child_id, skill_id, subject, scheduled_at, duration_minutes,
                               price, currency, series_id, notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).run(id, req.user.id, tutor_id, child_id || null, skill_id || null, subject || null, iso, duration,
        price, currency, seriesId, notes || null, ts, ts);
    }
  })();

  const [tutorUser, parentUser] = await Promise.all([
    db.prepare('SELECT * FROM users WHERE id = ?').get(tutor_id),
    db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id),
  ]);
  await notifyUser(tutorUser, templates.bookingRequested(parentUser.full_name, weeks > 1 ? `${subject || 'lessons'} (${weeks} weekly lessons)` : subject));

  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ?').get(ids[0]);
  if (weeks === 1) return res.status(201).json({ booking });
  const series = await db.prepare('SELECT * FROM bookings WHERE series_id = ? ORDER BY scheduled_at').all(seriesId);
  res.status(201).json({ booking, series_id: seriesId, bookings: series });
}

/** GET /api/bookings/mine */
async function listMine(req, res) {
  let rows;
  let paging = null;
  let total = 0;
  if (req.user.role === 'parent' || req.user.role === 'adult_student') {
    rows = await db
      .prepare(
        `SELECT b.*, u.full_name AS tutor_name, c.full_name AS child_name
         FROM bookings b
         JOIN users u ON u.id = b.tutor_id
         LEFT JOIN children c ON c.id = b.child_id
         WHERE b.parent_id = ? AND b.deleted_at IS NULL ORDER BY b.created_at DESC`
      )
      .all(req.user.id);
  } else if (req.user.role === 'tutor') {
    rows = await db
      .prepare(
        `SELECT b.*, u.full_name AS parent_name, c.full_name AS child_name
         FROM bookings b
         JOIN users u ON u.id = b.parent_id
         LEFT JOIN children c ON c.id = b.child_id
         WHERE b.tutor_id = ? AND b.deleted_at IS NULL ORDER BY b.created_at DESC`
      )
      .all(req.user.id);
  } else if (req.user.role === 'child') {
    const child = await db.prepare('SELECT id FROM children WHERE user_id = ?').get(req.user.id);
    rows = child
      ? await db
          .prepare(
            `SELECT b.*, u.full_name AS tutor_name, c.full_name AS child_name
             FROM bookings b
             JOIN users u ON u.id = b.tutor_id
             JOIN children c ON c.id = b.child_id
             WHERE b.child_id = ? AND b.deleted_at IS NULL ORDER BY b.created_at DESC`
          )
          .all(child.id)
      : [];
  } else if (req.user.role === 'super_admin') {
    paging = getPaging(req);
    total = (await db.prepare('SELECT COUNT(*) AS count FROM bookings WHERE deleted_at IS NULL').get()).count;
    rows = await db.prepare('SELECT * FROM bookings WHERE deleted_at IS NULL ORDER BY created_at DESC, id LIMIT ? OFFSET ?').all(paging.limit, paging.offset);
  } else {
    return res.status(403).json({ error: 'Not available for this role' });
  }
  res.json({ bookings: rows, ...(paging ? pageMeta(paging, total) : {}) });
}

function canActOn(user, booking) {
  return ((user.role === 'parent' || user.role === 'adult_student') && booking.parent_id === user.id) ||
    (user.role === 'tutor' && booking.tutor_id === user.id) ||
    user.role === 'super_admin';
}

/** Validates one transition. Returns null when allowed, otherwise { code, error }. */
async function checkTransition(user, booking, status) {
  const allowedNext = VALID_TRANSITIONS[user.role]?.[booking.status] || [];
  if (!allowedNext.includes(status)) {
    return { code: 400, error: `Cannot move booking from ${booking.status} to ${status}` };
  }
  if (status === 'completed') {
    const paid = await db.prepare("SELECT id FROM payments WHERE booking_id = ? AND status = 'successful'").get(booking.id);
    if (!paid) return { code: 400, error: 'This booking must be paid for before it can be marked completed' };
  }
  if (status === 'confirmed' && booking.scheduled_at &&
      (await findConflict(booking.tutor_id, booking.scheduled_at, booking.id, booking.duration_minutes || LESSON_MINUTES))) {
    return { code: 409, error: 'You already have a confirmed lesson at that time — reschedule this one first.' };
  }
  return null;
}

async function notifyTransition(user, booking, status, subjectOverride) {
  const subject = subjectOverride || booking.subject;
  if (status === 'completed') {
    const [t, p] = await Promise.all([
      db.prepare('SELECT full_name FROM users WHERE id = ?').get(booking.tutor_id),
      db.prepare('SELECT * FROM users WHERE id = ?').get(booking.parent_id),
    ]);
    if (p && t) await notifyUser(p, templates.lessonCompleted(t.full_name, subject));
    return;
  }
  if (status !== 'confirmed' && status !== 'cancelled') return;
  const [tutorUser, parentUser] = await Promise.all([
    db.prepare('SELECT * FROM users WHERE id = ?').get(booking.tutor_id),
    db.prepare('SELECT * FROM users WHERE id = ?').get(booking.parent_id),
  ]);
  if (status === 'confirmed') {
    // Only the tutor (or an admin) can confirm, so the parent is always the recipient.
    await notifyUser(parentUser, templates.bookingConfirmed(tutorUser.full_name, subject));
  } else if (booking.status === 'pending' && user.role === 'tutor') {
    // A tutor declining a request that never got confirmed reads better as a decline than a cancellation.
    await notifyUser(parentUser, templates.bookingDeclined(tutorUser.full_name));
  } else {
    const actingUser = user.role === 'tutor' ? tutorUser : parentUser;
    const otherUser = user.role === 'tutor' ? parentUser : tutorUser;
    await notifyUser(otherUser, templates.bookingCancelled(actingUser.full_name, subject));
  }
}

async function afterCompleted(booking) {
  if (!booking.child_id) return;
  await recordActivity(booking.child_id, 25);
  await recomputeProgress(booking.child_id, booking.skill_id);
}

/**
 * PATCH /api/bookings/:id/status  body: { status, apply_to_series? }
 * With apply_to_series (confirm or cancel only), every other lesson in the
 * same weekly series that can make the same move is updated too. Lessons
 * that can't (e.g. already completed) are skipped and listed in `skipped`.
 */
async function updateStatus(req, res) {
  const { id } = req.params;
  const { status, apply_to_series } = req.body || {};
  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (!canActOn(req.user, booking)) return res.status(403).json({ error: 'Not your booking' });

  const problem = await checkTransition(req.user, booking, status);
  if (problem) return res.status(problem.code).json({ error: problem.error });

  const wholeSeries = !!apply_to_series && !!booking.series_id && ['confirmed', 'cancelled'].includes(status);
  let targets = [booking];
  const skipped = [];
  if (wholeSeries) {
    const others = await db.prepare(
      'SELECT * FROM bookings WHERE series_id = ? AND id <> ? AND deleted_at IS NULL ORDER BY scheduled_at'
    ).all(booking.series_id, booking.id);
    for (const other of others) {
      if (other.status === status) continue;
      const otherProblem = await checkTransition(req.user, other, status);
      if (otherProblem) skipped.push({ id: other.id, scheduled_at: other.scheduled_at, reason: otherProblem.error });
      else targets.push(other);
    }
  }

  const ts = now();
  for (const b of targets) {
    await db.prepare('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?').run(status, ts, b.id);
    if (status === 'completed') await afterCompleted(b);
  }

  // One message per action, not one per lesson in the series.
  await notifyTransition(req.user, booking, status, targets.length > 1 ? `${booking.subject || 'lessons'} (${targets.length} lessons)` : null);

  const updated = await db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!wholeSeries) return res.json({ booking: updated });
  res.json({ booking: updated, updated_ids: targets.map((b) => b.id), skipped });
}

/** GET /api/bookings/:id  (the parent or tutor on the booking, or an admin) */
async function getOne(req, res) {
  const { id } = req.params;
  const booking = await db
    .prepare(
      `SELECT b.*, ut.full_name AS tutor_name, up.full_name AS parent_name, c.full_name AS child_name
       FROM bookings b
       JOIN users ut ON ut.id = b.tutor_id
       JOIN users up ON up.id = b.parent_id
       LEFT JOIN children c ON c.id = b.child_id
       WHERE b.id = ? AND b.deleted_at IS NULL`
    )
    .get(id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  let isParticipant =
    req.user.role === 'super_admin' || booking.parent_id === req.user.id || booking.tutor_id === req.user.id;
  if (!isParticipant && req.user.role === 'child' && booking.child_id) {
    const child = await db.prepare('SELECT user_id FROM children WHERE id = ?').get(booking.child_id);
    isParticipant = !!child && child.user_id === req.user.id;
  }
  if (!isParticipant) return res.status(403).json({ error: 'Not your booking' });

  res.json({ booking });
}

/**
 * PATCH /api/bookings/:id/schedule  body: { scheduled_at }
 * Either participant may (re)set the lesson time while the booking is
 * pending or confirmed. The other party is notified and the reminder re-armed.
 */
async function reschedule(req, res) {
  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  const isTutor = req.user.role === 'tutor' && booking.tutor_id === req.user.id;
  const isPayer = ['parent', 'adult_student'].includes(req.user.role) && booking.parent_id === req.user.id;
  if (!isTutor && !isPayer && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Not your booking' });
  if (!['pending', 'confirmed'].includes(booking.status)) return res.status(400).json({ error: `A ${booking.status} booking can't be rescheduled` });

  const sched = normalizeScheduledAt((req.body || {}).scheduled_at);
  if (sched.error) return res.status(400).json({ error: sched.error });
  if (!sched.iso) return res.status(400).json({ error: 'scheduled_at is required' });
  const duration = booking.duration_minutes || LESSON_MINUTES;
  if (!(await withinAvailability(booking.tutor_id, sched.iso, duration))) {
    return res.status(409).json({ error: "That time is outside the tutor's published availability." });
  }
  if (await findConflict(booking.tutor_id, sched.iso, booking.id, duration)) {
    return res.status(409).json({ error: 'The tutor already has a lesson at that time.' });
  }

  await db.prepare('UPDATE bookings SET scheduled_at = ?, reminder_sent_at = NULL, updated_at = ? WHERE id = ?').run(sched.iso, now(), booking.id);

  const otherId = isTutor ? booking.parent_id : booking.tutor_id;
  const [other, me] = await Promise.all([
    db.prepare('SELECT * FROM users WHERE id = ?').get(otherId),
    db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id),
  ]);
  if (other) await notifyUser(other, templates.bookingRescheduled(me.full_name, booking.subject, sched.iso));

  res.json({ booking: await db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id) });
}

function icsEscape(s) { return String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'); }
function icsDate(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }

/** GET /api/bookings/:id/ics — calendar file for a scheduled lesson (participants only). */
async function ics(req, res) {
  const b = await db.prepare(
    `SELECT b.*, ut.full_name AS tutor_name, up.full_name AS parent_name FROM bookings b
     JOIN users ut ON ut.id = b.tutor_id JOIN users up ON up.id = b.parent_id WHERE b.id = ? AND b.deleted_at IS NULL`
  ).get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (![b.tutor_id, b.parent_id].includes(req.user.id) && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Not your booking' });
  if (!b.scheduled_at) return res.status(400).json({ error: 'This lesson has no time yet' });
  const start = new Date(b.scheduled_at);
  const end = new Date(start.getTime() + (b.duration_minutes || LESSON_MINUTES) * 60000);
  const who = req.user.id === b.tutor_id ? b.parent_name : b.tutor_name;
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lesson Teacher//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:booking-${b.id}@lessonteacher`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(`Lesson${b.subject ? `: ${b.subject}` : ''} with ${who}`)}`,
    `STATUS:${b.status === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE'}`, 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  res.set('Content-Type', 'text/calendar; charset=utf-8').set('Content-Disposition', 'attachment; filename="lesson.ics"').send(body);
}

/** GET /api/bookings/:id/call-chat — the in-lesson chat log (participants, including the child, and admins). */
async function callChat(req, res) {
  const b = await db.prepare('SELECT * FROM bookings WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  let allowed = req.user.role === 'super_admin' || [b.tutor_id, b.parent_id].includes(req.user.id);
  if (!allowed && req.user.role === 'child' && b.child_id) {
    const c = await db.prepare('SELECT user_id FROM children WHERE id = ?').get(b.child_id);
    allowed = !!c && c.user_id === req.user.id;
  }
  if (!allowed) return res.status(403).json({ error: 'Not your booking' });
  const messages = await db.prepare(
    `SELECT m.id, m.sender_id, m.sender_role, m.body, m.created_at, u.full_name AS sender_name
       FROM lesson_call_messages m JOIN users u ON u.id = m.sender_id
      WHERE m.booking_id = ? ORDER BY m.created_at`
  ).all(b.id);
  res.json({ messages });
}

module.exports = { callChat, reschedule, ics, create, listMine, getOne, updateStatus };
