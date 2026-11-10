// Lesson times are stored as UTC ISO strings; inputs are <input type="datetime-local"> in the user's own zone.
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/** 'YYYY-MM-DDTHH:MM' (local wall time) -> UTC ISO string, or '' if empty/invalid. */
export function localInputToIso(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** Value for a datetime-local input's `min` (now, local, minute precision). */
export function nowLocalInput() {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

/** UTC ISO -> datetime-local input value in the viewer's zone. */
export function isoToLocalInput(iso) {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function formatLesson(iso, tz) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz, timeZoneName: 'short' });
}

/** [{day_of_week,start_time,end_time}] -> "Mon 09:00–12:00, Wed 14:00–16:00" */
export function formatAvailability(slots) {
  return (slots || []).map((s) => `${DAY_NAMES[s.day_of_week].slice(0, 3)} ${s.start_time}–${s.end_time}`).join(', ');
}

export function timeZoneOptions(current) {
  let list = [];
  try { list = Intl.supportedValuesOf('timeZone'); } catch { list = ['Africa/Lagos', 'UTC']; }
  return list.includes(current) ? list : [current, ...list];
}
