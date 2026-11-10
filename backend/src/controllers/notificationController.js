const db = require('../config/db');
const { getPaging, pageMeta } = require('../utils/paging');

function now() {
  return new Date().toISOString();
}

/** GET /api/notifications  — the signed-in user's in-app inbox, newest first. */
async function list(req, res) {
  const paging = getPaging(req, { defaultSize: 20, maxSize: 100 });
  const unreadOnly = req.query.unread === 'true' || req.query.unread === '1';
  const where = `user_id = ? AND channel = 'in_app'${unreadOnly ? ' AND read_at IS NULL' : ''}`;
  const total = (await db.prepare(`SELECT COUNT(*) AS count FROM notifications WHERE ${where}`).get(req.user.id)).count;
  const notifications = await db
    .prepare(`SELECT id, type, subject, body, created_at, read_at FROM notifications WHERE ${where} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`)
    .all(req.user.id, paging.limit, paging.offset);
  const unread = (await db
    .prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND channel = 'in_app' AND read_at IS NULL")
    .get(req.user.id)).count;
  res.json({ notifications, unread_count: Number(unread), ...pageMeta(paging, total) });
}

/** GET /api/notifications/unread-count — cheap poll for the bell badge. */
async function unreadCount(req, res) {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND channel = 'in_app' AND read_at IS NULL")
    .get(req.user.id);
  res.json({ unread_count: Number(row.count) });
}

/** PATCH /api/notifications/:id/read */
async function markRead(req, res) {
  const r = await db
    .prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ? AND channel = 'in_app'")
    .run(now(), req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Notification not found' });
  res.json({ ok: true });
}

/** POST /api/notifications/read-all */
async function markAllRead(req, res) {
  await db
    .prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND channel = 'in_app' AND read_at IS NULL")
    .run(now(), req.user.id);
  res.json({ ok: true, unread_count: 0 });
}

module.exports = { list, unreadCount, markRead, markAllRead };
