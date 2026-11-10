const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');
const { getSetting } = require('../utils/settings');
const { logAdminAction } = require('../services/auditLog');
const { notifyUser, templates } = require('../services/notifications');

function now() {
  return new Date().toISOString();
}

function hoursSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

/**
 * POST /api/refund-requests  (parent)  body: { booking_id, resolution: 'refund'|'reschedule', reason }
 * Satisfaction guarantee: a parent can ask for this within a
 * configurable window after a completed, paid lesson. This is a
 * ToS-backed policy decided case-by-case by staff, not an automatic
 * or insurance-backed payout.
 */
async function create(req, res) {
  if (!['parent','adult_student'].includes(req.user.role)) return res.status(403).json({ error: 'Only parents can request a refund or reschedule' });

  const { booking_id, resolution = 'refund', reason } = req.body || {};
  if (!booking_id || !reason) return res.status(400).json({ error: 'booking_id and reason are required' });
  if (!['refund', 'reschedule'].includes(resolution)) {
    return res.status(400).json({ error: "resolution must be 'refund' or 'reschedule'" });
  }

  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND parent_id = ? AND deleted_at IS NULL').get(booking_id, req.user.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.status !== 'completed') return res.status(400).json({ error: 'Only a completed booking is eligible' });

  const payment = await db.prepare("SELECT * FROM payments WHERE booking_id = ? AND status = 'successful'").get(booking_id);
  if (!payment) return res.status(400).json({ error: 'No successful payment found for this booking' });

  const windowHours = Number(await getSetting('satisfaction_guarantee_hours'));
  if (hoursSince(booking.updated_at) > windowHours) {
    return res.status(400).json({ error: `The satisfaction-guarantee window (${windowHours}h after the lesson) has passed` });
  }

  const existing = await db.prepare("SELECT id FROM refund_requests WHERE booking_id = ? AND status NOT IN ('denied')").get(booking_id);
  if (existing) return res.status(400).json({ error: 'A request already exists for this booking' });

  const id = uuidv4();
  const ts = now();
  await db
    .prepare(
      `INSERT INTO refund_requests (id, booking_id, payment_id, requested_by, reason, resolution, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, booking_id, payment.id, req.user.id, reason, resolution, ts, ts);

  res.status(201).json({ refund_request: await db.prepare('SELECT * FROM refund_requests WHERE id = ?').get(id) });
}

/** GET /api/refund-requests/mine  (parent) */
async function mine(req, res) {
  if (!['parent','adult_student'].includes(req.user.role)) return res.status(403).json({ error: 'Only parents have requests to list here' });
  const rows = await db.prepare('SELECT * FROM refund_requests WHERE requested_by = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ refund_requests: rows });
}

/** GET /api/refund-requests  (super_admin) — queue of pending/resolved requests */
async function list(req, res) {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Admins only' });
  const { status } = req.query;
  const rows = status
    ? await db.prepare('SELECT * FROM refund_requests WHERE status = ? ORDER BY created_at DESC').all(status)
    : await db.prepare('SELECT * FROM refund_requests ORDER BY created_at DESC').all();
  res.json({ refund_requests: rows });
}

/**
 * PATCH /api/refund-requests/:id/resolve  (super_admin)
 * body: { status: 'approved'|'denied'|'completed', resolution_note? }
 * Approving a 'refund' resolution marks the underlying payment
 * 'refunded' — the actual money movement back to the parent still
 * happens through the payment provider's own refund flow/dashboard;
 * this records the platform-side decision and state.
 */
async function resolve(req, res) {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Admins only' });
  const { id } = req.params;
  const { status, resolution_note } = req.body || {};
  if (!['approved', 'denied', 'completed'].includes(status)) {
    return res.status(400).json({ error: "status must be 'approved', 'denied', or 'completed'" });
  }

  const request = await db.prepare('SELECT * FROM refund_requests WHERE id = ?').get(id);
  if (!request) return res.status(404).json({ error: 'Refund request not found' });
  if (['denied', 'completed'].includes(request.status)) {
    return res.status(409).json({ error: `This request is already ${request.status} and can't be changed` });
  }

  const ts = now();
  await db
    .prepare('UPDATE refund_requests SET status = ?, resolved_by = ?, resolution_note = ?, resolved_at = ?, updated_at = ? WHERE id = ?')
    .run(status, req.user.id, resolution_note || null, ts, ts, id);

  if (status === 'completed' && request.resolution === 'refund') {
    await db.prepare("UPDATE payments SET status = 'refunded', updated_at = ? WHERE id = ?").run(ts, request.payment_id);
  }

  await logAdminAction(req.user.id, 'refund.resolve', { targetType: 'refund_request', targetId: id, details: { status } });
  const parent = await db.prepare('SELECT * FROM users WHERE id = ?').get(request.requested_by);
  if (parent) await notifyUser(parent, templates.refundRequestResolved(status, request.resolution));

  res.json({ refund_request: await db.prepare('SELECT * FROM refund_requests WHERE id = ?').get(id) });
}

module.exports = { create, mine, list, resolve };
