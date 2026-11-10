const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');
const { isValidTimeZone, DEFAULT_TZ } = require('../utils/schedule');

function now() {
  return new Date().toISOString();
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // 'HH:MM', 24h

function validateSlots(slots) {
  if (!Array.isArray(slots)) return 'slots must be an array';
  for (const slot of slots) {
    const { day_of_week, start_time, end_time } = slot || {};
    if (!Number.isInteger(day_of_week) || day_of_week < 0 || day_of_week > 6) {
      return 'each slot needs an integer day_of_week between 0 (Sunday) and 6 (Saturday)';
    }
    if (!TIME_RE.test(start_time) || !TIME_RE.test(end_time)) {
      return 'start_time and end_time must be 24h "HH:MM" strings';
    }
    if (start_time >= end_time) {
      return 'start_time must be before end_time';
    }
  }
  const byDay = {};
  for (const s of slots) (byDay[s.day_of_week] ||= []).push(s);
  for (const day of Object.values(byDay)) {
    day.sort((a, b) => a.start_time.localeCompare(b.start_time));
    for (let i = 1; i < day.length; i++) {
      if (day[i].start_time < day[i - 1].end_time) return 'availability slots on the same day must not overlap';
    }
  }
  return null;
}

/** GET /api/tutors/me/availability */
async function listMine(req, res) {
  const rows = await db
    .prepare('SELECT * FROM tutor_availability WHERE tutor_id = ? ORDER BY day_of_week ASC, start_time ASC')
    .all(req.user.id);
  const prof = await db.prepare('SELECT timezone FROM tutor_profiles WHERE user_id = ?').get(req.user.id);
  res.json({ slots: rows, timezone: isValidTimeZone(prof?.timezone) ? prof.timezone : DEFAULT_TZ });
}

/**
 * PUT /api/tutors/me/availability  body: { slots: [{ day_of_week, start_time, end_time }, ...] }
 * Replaces the tutor's whole weekly schedule in one call, same pattern as
 * other "set my full list" endpoints in this app (e.g. tutor skills) —
 * simpler for a small weekly grid than diffing individual adds/removes.
 */
async function replaceMine(req, res) {
  const { slots, timezone } = req.body || {};
  const error = validateSlots(slots);
  if (error) return res.status(400).json({ error });
  if (timezone !== undefined && timezone !== null && !isValidTimeZone(timezone)) {
    return res.status(400).json({ error: 'timezone must be a valid IANA time zone, e.g. Africa/Lagos' });
  }

  const txn = db.transaction(async () => {
    await db.prepare('DELETE FROM tutor_availability WHERE tutor_id = ?').run(req.user.id);
    const ts = now();
    for (const slot of slots) {
      await db.prepare(
        `INSERT INTO tutor_availability (id, tutor_id, day_of_week, start_time, end_time, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(uuidv4(), req.user.id, slot.day_of_week, slot.start_time, slot.end_time, ts, ts);
    }
  });
  await txn();
  if (timezone) await db.prepare('UPDATE tutor_profiles SET timezone = ?, updated_at = ? WHERE user_id = ?').run(timezone, now(), req.user.id);

  const rows = await db
    .prepare('SELECT * FROM tutor_availability WHERE tutor_id = ? ORDER BY day_of_week ASC, start_time ASC')
    .all(req.user.id);
  const prof = await db.prepare('SELECT timezone FROM tutor_profiles WHERE user_id = ?').get(req.user.id);
  res.json({ slots: rows, timezone: isValidTimeZone(prof?.timezone) ? prof.timezone : DEFAULT_TZ });
}

/** GET /api/tutors/:id/availability — any authenticated user viewing a tutor's published schedule */
async function getForTutor(req, res) {
  const tutor = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'tutor' AND deleted_at IS NULL").get(req.params.id);
  if (!tutor) return res.status(404).json({ error: 'Tutor not found' });

  const rows = await db
    .prepare('SELECT day_of_week, start_time, end_time FROM tutor_availability WHERE tutor_id = ? ORDER BY day_of_week ASC, start_time ASC')
    .all(req.params.id);
  const prof = await db.prepare('SELECT timezone FROM tutor_profiles WHERE user_id = ?').get(req.params.id);
  res.json({ slots: rows, timezone: isValidTimeZone(prof?.timezone) ? prof.timezone : DEFAULT_TZ });
}

module.exports = { listMine, replaceMine, getForTutor };
