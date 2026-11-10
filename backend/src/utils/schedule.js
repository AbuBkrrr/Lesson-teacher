const db = require('../config/db');

// Lessons are treated as one hour long for conflict / availability checks.
const LESSON_MINUTES = 60;
const DEFAULT_TZ = 'Africa/Lagos';
const GRACE_MS = 5 * 60 * 1000;

function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/**
 * Normalises a client-supplied lesson time to a UTC ISO string.
 * Strings without an explicit offset are treated as UTC (clients should send
 * `new Date(local).toISOString()`). Returns { iso } or { error }.
 */
function normalizeScheduledAt(value, { allowPast = false } = {}) {
  if (value === undefined || value === null || value === '') return { iso: null };
  const raw = String(value).trim();
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const d = new Date(hasZone || !/T/.test(raw) ? raw : `${raw}Z`);
  if (Number.isNaN(d.getTime())) return { error: 'scheduled_at is not a valid date/time' };
  if (!allowPast && d.getTime() < Date.now() - GRACE_MS) return { error: 'scheduled_at must be in the future' };
  return { iso: d.toISOString() };
}

/** Day-of-week (0=Sun) and 'HH:MM' of an instant as seen in a time zone. */
function localParts(iso, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t) => parts.find((p) => p.type === t).value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const hh = get('hour') === '24' ? '00' : get('hour');
  return { dow, time: `${hh}:${get('minute')}` };
}

function addMinutes(time, mins) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  return total >= 24 * 60 ? '24:00' : `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Allowed lesson lengths in minutes. */
const DURATIONS = [30, 45, 60, 90, 120];

/** True if no slots are published, or the whole lesson fits inside one slot. */
async function withinAvailability(tutorId, iso, durationMinutes = LESSON_MINUTES) {
  const slots = await db.prepare('SELECT day_of_week, start_time, end_time FROM tutor_availability WHERE tutor_id = ?').all(tutorId);
  if (slots.length === 0) return true;
  const profile = await db.prepare('SELECT timezone FROM tutor_profiles WHERE user_id = ?').get(tutorId);
  const tz = isValidTimeZone(profile?.timezone) ? profile.timezone : DEFAULT_TZ;
  const { dow, time } = localParts(iso, tz);
  const end = addMinutes(time, durationMinutes);
  return slots.some((s) => s.day_of_week === dow && s.start_time <= time && s.end_time >= end);
}

/** A different confirmed booking of this tutor overlapping the proposed lesson. */
async function findConflict(tutorId, iso, excludeBookingId, durationMinutes = LESSON_MINUTES) {
  const start = new Date(iso).getTime();
  const end = start + durationMinutes * 60 * 1000;
  const rows = await db
    .prepare("SELECT id, scheduled_at, duration_minutes FROM bookings WHERE tutor_id = ? AND status = 'confirmed' AND scheduled_at IS NOT NULL AND deleted_at IS NULL AND id <> ?")
    .all(tutorId, excludeBookingId || '');
  return rows.find((r) => {
    const s = new Date(r.scheduled_at).getTime();
    if (Number.isNaN(s)) return false;
    const e = s + (Number(r.duration_minutes) || LESSON_MINUTES) * 60 * 1000;
    return s < end && start < e;
  }) || null;
}

module.exports = { LESSON_MINUTES, DURATIONS, DEFAULT_TZ, isValidTimeZone, normalizeScheduledAt, withinAvailability, findConflict };
