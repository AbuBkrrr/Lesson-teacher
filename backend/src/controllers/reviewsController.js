const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');
const { notifyUser, templates } = require('../services/notifications');

function now() {
  return new Date().toISOString();
}

async function recomputeTutorRating(tutorId) {
  const row = await db
    .prepare('SELECT COALESCE(AVG(rating), 0) AS avg_rating, COUNT(*) AS count FROM reviews WHERE tutor_id = ? AND deleted_at IS NULL')
    .get(tutorId);
  await db
    .prepare('UPDATE tutor_profiles SET rating = ?, review_count = ?, updated_at = ? WHERE user_id = ?')
    .run(Number(row.avg_rating), Number(row.count), now(), tutorId);
}

/**
 * POST /api/reviews  (parent)  body: { booking_id, rating, comment? }
 * Allowed only once per completed, successfully-paid booking that
 * belongs to this parent — a review is evidence of a real lesson, not
 * a free-text testimonial anyone could fabricate.
 */
async function create(req, res) {
  if (!['parent','adult_student'].includes(req.user.role)) return res.status(403).json({ error: 'Only parents can leave a review' });

  const { booking_id, rating, comment } = req.body || {};
  const ratingNum = Number(rating);
  if (!booking_id || !Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'booking_id and an integer rating from 1 to 5 are required' });
  }

  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND parent_id = ? AND deleted_at IS NULL').get(booking_id, req.user.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.status !== 'completed') return res.status(400).json({ error: 'Only a completed booking can be reviewed' });

  const existing = await db.prepare('SELECT id FROM reviews WHERE booking_id = ? AND deleted_at IS NULL').get(booking_id);
  if (existing) return res.status(400).json({ error: 'This booking already has a review' });

  const id = uuidv4();
  const ts = now();
  await db
    .prepare('INSERT INTO reviews (id, booking_id, parent_id, tutor_id, rating, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, booking_id, req.user.id, booking.tutor_id, ratingNum, comment || null, ts, ts);

  await recomputeTutorRating(booking.tutor_id);

  const [tutorUser, parentUser] = await Promise.all([
    db.prepare('SELECT * FROM users WHERE id = ?').get(booking.tutor_id),
    db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id),
  ]);
  if (tutorUser) await notifyUser(tutorUser, templates.newReviewReceived(parentUser.full_name, ratingNum));

  res.status(201).json({ review: await db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) });
}

/** GET /api/reviews/tutor/:tutorId — public, used on a tutor's profile/discovery card */
async function listForTutor(req, res) {
  const { tutorId } = req.params;
  const rows = await db
    .prepare(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.full_name AS parent_name
       FROM reviews r JOIN users u ON u.id = r.parent_id
       WHERE r.tutor_id = ? AND r.deleted_at IS NULL ORDER BY r.created_at DESC LIMIT 100`
    )
    .all(tutorId);
  res.json({ reviews: rows });
}

/** GET /api/reviews/mine — a parent's own submitted reviews */
async function mine(req, res) {
  if (!['parent','adult_student'].includes(req.user.role)) return res.status(403).json({ error: 'Only parents have reviews to list here' });
  const rows = await db
    .prepare(
      `SELECT r.*, u.full_name AS tutor_name FROM reviews r JOIN users u ON u.id = r.tutor_id
       WHERE r.parent_id = ? AND r.deleted_at IS NULL ORDER BY r.created_at DESC`
    )
    .all(req.user.id);
  res.json({ reviews: rows });
}

/**
 * POST /api/reviews/tutors/:tutorId/verify  (super_admin)  body: { verified: boolean }
 * Sets the in-platform "platform-verified" flag after a staff member
 * manually checks a tutor's listed evidence/credentials. This is
 * never surfaced as, or treated internally as, a government license,
 * certification, or accreditation.
 */
async function setPlatformVerified(req, res) {
  const { tutorId } = req.params;
  const { verified } = req.body || {};

  const profile = await db.prepare('SELECT id FROM tutor_profiles WHERE user_id = ?').get(tutorId);
  if (!profile) return res.status(404).json({ error: 'Tutor profile not found' });

  const ts = now();
  await db
    .prepare('UPDATE tutor_profiles SET platform_verified = ?, platform_verified_at = ?, platform_verified_by = ?, updated_at = ? WHERE user_id = ?')
    .run(verified ? 1 : 0, verified ? ts : null, verified ? req.user.id : null, ts, tutorId);

  await require('../services/auditLog').logAdminAction(req.user.id, verified ? 'tutor.platform_verify' : 'tutor.platform_unverify', { targetType: 'user', targetId: tutorId });
  res.json({ tutor_profile: await db.prepare('SELECT * FROM tutor_profiles WHERE user_id = ?').get(tutorId) });
}

module.exports = { create, listForTutor, mine, setPlatformVerified };
