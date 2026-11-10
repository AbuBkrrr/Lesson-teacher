const db = require('../config/db');
const { getPaging, pageMeta } = require('../utils/paging');
const { uuidv4 } = require('../utils/referral');
const { notifyUser, templates } = require('../services/notifications');
const { recordActivity } = require('../services/gamification');
const { normalizeScheduledAt, withinAvailability, findConflict, LESSON_MINUTES } = require('../utils/schedule');

function now() {
  return new Date().toISOString();
}

const VALID_TRANSITIONS = {
  parent: { pending: ['cancelled'], confirmed: ['cancelled'] },
  adult_student: { pending: ['cancelled'], confirmed: ['cancelled'] },
  tutor: { pending: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled'] },
  super_admin: { pending: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled'] },
};

/** POST /api/bookings  (parent or adult_student — an adult student books for themselves, so child_id is omitted) */
async function create(req, res) {
  if (req.user.role !== 'parent' && req.user.role !== 'adult_student') {
    return res.status(403).json({ error: 'Only parents or adult students can request a booking' });
  }

  const { tutor_id, child_id, subject, scheduled_at } = req.body || {};
  if (!tutor_id) return res.status(400).json({ error: 'tutor_id is required' });

  const tutor = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'tutor' AND deleted_at IS NULL").get(tutor_id);
  if (!tutor) return res.status(400).json({ error: 'tutor_id does not match a known tutor' });

  if (req.user.role === 'adult_student' && child_id) {
    return res.status(400).json({ error: 'Adult students book for themselves and cannot set a child_id' });
  }

  if (child_id) {
    const child = await db.prepare('SELECT id FROM children WHERE id = ? AND parent_id = ?').get(child_id, req.user.id);
    if (!child) return res.status(400).json({ error: 'child_id does not match one of your children' });
  }

  const sched = normalizeScheduledAt(scheduled_at);
  if (sched.error) return res.status(400).json({ error: sched.error });
  if (sched.iso) {
    if (!(await withinAvailability(tutor_id, sched.iso))) {
      return res.status(409).json({ error: "That time is outside the tutor's published availability — pick a slot they offer." });
    }
    if (await findConflict(tutor_id, sched.iso)) {
      return res.status(409).json({ error: 'The tutor already has a lesson at that time — pick another slot.' });
    }
  }

  const id = uuidv4();
  const ts = now();
  await db.prepare(
    `INSERT INTO bookings (id, parent_id, tutor_id, child_id, subject, scheduled_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(id, req.user.id, tutor_id, child_id || null, subject || null, sched.iso, ts, ts);

  const [tutorUser, parentUser] = await Promise.all([
    db.prepare('SELECT * FROM users WHERE id = ?').get(tutor_id),
    db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id),
  ]);
  await notifyUser(tutorUser, templates.bookingRequested(parentUser.full_name, subject));

  res.status(201).json({ booking: await db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) });
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

/** PATCH /api/bookings/:id/status  body: { status } */
async function updateStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body || {};
  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  const isOwner =
    ((req.user.role === 'parent' || req.user.role === 'adult_student') && booking.parent_id === req.user.id) ||
    (req.user.role === 'tutor' && booking.tutor_id === req.user.id) ||
    req.user.role === 'super_admin';
  if (!isOwner) return res.status(403).json({ error: 'Not your booking' });

  const allowedNext = VALID_TRANSITIONS[req.user.role]?.[booking.status] || [];
  if (!allowedNext.includes(status)) {
    return res.status(400).json({ error: `Cannot move booking from ${booking.status} to ${status}` });
  }

  if (status === 'completed') {
    const paid = await db.prepare("SELECT id FROM payments WHERE booking_id = ? AND status = 'successful'").get(booking.id);
    if (!paid) return res.status(400).json({ error: 'This booking must be paid for before it can be marked completed' });
  }

  if (status === 'confirmed' && booking.scheduled_at && (await findConflict(booking.tutor_id, booking.scheduled_at, booking.id))) {
    return res.status(409).json({ error: 'You already have a confirmed lesson at that time — reschedule this one first.' });
  }

  await db.prepare('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);

  if (status === 'completed' && booking.child_id) {
    await recordActivity(booking.child_id, 25);
  }
  if (status === 'completed') {
    const [t, p] = await Promise.all([
      db.prepare('SELECT full_name FROM users WHERE id = ?').get(booking.tutor_id),
      db.prepare('SELECT * FROM users WHERE id = ?').get(booking.parent_id),
    ]);
    if (p && t) await notifyUser(p, templates.lessonCompleted(t.full_name, booking.subject));
  }

  if (status === 'confirmed' || status === 'cancelled') {
    const [tutorUser, parentUser] = await Promise.all([
      db.prepare('SELECT * FROM users WHERE id = ?').get(booking.tutor_id),
      db.prepare('SELECT * FROM users WHERE id = ?').get(booking.parent_id),
    ]);

    if (status === 'confirmed') {
      // Only the tutor can perform this transition (see VALID_TRANSITIONS), so the parent is always the recipient.
      await notifyUser(parentUser, templates.bookingConfirmed(tutorUser.full_name, booking.subject));
    } else if (booking.status === 'pending' && req.user.role === 'tutor') {
      // A tutor declining a request that never got confirmed reads better as a decline than a cancellation.
      await notifyUser(parentUser, templates.bookingDeclined(tutorUser.full_name));
    } else {
      const actingUser = req.user.role === 'tutor' ? tutorUser : parentUser;
      const otherUser = req.user.role === 'tutor' ? parentUser : tutorUser;
      await notifyUser(otherUser, templates.bookingCancelled(actingUser.full_name, booking.subject));
    }
  }

  res.json({ booking: await db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) });
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
  if (!(await withinAvailability(booking.tutor_id, sched.iso))) {
    return res.status(409).json({ error: "That time is outside the tutor's published availability." });
  }
  if (await findConflict(booking.tutor_id, sched.iso, booking.id)) {
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
  const end = new Date(start.getTime() + LESSON_MINUTES * 60000);
  const who = req.user.id === b.tutor_id ? b.parent_name : b.tutor_name;
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lesson Teacher//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:booking-${b.id}@lessonteacher`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(`Lesson${b.subject ? `: ${b.subject}` : ''} with ${who}`)}`,
    `STATUS:${b.status === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE'}`, 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  res.set('Content-Type', 'text/calendar; charset=utf-8').set('Content-Disposition', 'attachment; filename="lesson.ics"').send(body);
}

module.exports = { reschedule, ics, create, listMine, getOne, updateStatus };
