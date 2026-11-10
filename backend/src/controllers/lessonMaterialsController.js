const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');
const { getStorageProvider } = require('../services/storageProviders');
const { getProvider } = require('../services/paymentProviders');

function now() {
  return new Date().toISOString();
}

function uploadMiddleware(req, res, next) {
  return getStorageProvider().uploadMiddleware(req, res, next);
}

/**
 * POST /api/lesson-materials  (tutor)
 * multipart/form-data: file, title, description, curriculum_unit_id?
 */
async function upload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'A file is required (form field name: file)' });
  const { title, description, curriculum_unit_id, is_premium, price, currency } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });

  const premium = is_premium === true || is_premium === 'true';
  if (premium && !price) return res.status(400).json({ error: 'price is required for a premium (paid) material' });

  if (curriculum_unit_id) {
    const unit = await db.prepare('SELECT id FROM curriculum_units WHERE id = ? AND deleted_at IS NULL').get(curriculum_unit_id);
    if (!unit) return res.status(400).json({ error: 'curriculum_unit_id does not match a known curriculum unit' });
  }

  const provider = getStorageProvider();
  const { fileUrl, fileType } = await provider.describeUploadedFile(req, req.file);

  const id = uuidv4();
  const ts = now();
  await db.prepare(
    `INSERT INTO lesson_materials (id, tutor_id, curriculum_unit_id, title, description, file_url, file_type, is_premium, price, currency, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.user.id, curriculum_unit_id || null, title, description || null, fileUrl, fileType, premium ? 1 : 0, premium ? Number(price) : null, currency || 'NGN', ts, ts);

  res.status(201).json({ material: await db.prepare('SELECT * FROM lesson_materials WHERE id = ?').get(id) });
}

/** GET /api/lesson-materials/mine  (tutor) */
async function mine(req, res) {
  const rows = await db
    .prepare('SELECT * FROM lesson_materials WHERE tutor_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
    .all(req.user.id);
  res.json({ materials: rows });
}

/**
 * GET /api/lesson-materials/tutor/:tutorId  (parent/child with a
 * confirmed/completed booking with that tutor, or the tutor themselves,
 * or super_admin)
 */
async function listForTutor(req, res) {
  const { tutorId } = req.params;

  if (req.user.role === 'tutor' && req.user.id !== tutorId) {
    return res.status(403).json({ error: 'Not your materials' });
  }

  if (req.user.role === 'parent' || req.user.role === 'adult_student' || req.user.role === 'child') {
    const childId = req.user.role === 'child'
      ? (await db.prepare('SELECT id FROM children WHERE user_id = ?').get(req.user.id))?.id
      : null;

    const relationship = req.user.role === 'child'
      ? await db.prepare(`SELECT id FROM bookings WHERE tutor_id = ? AND child_id = ? AND status IN ('confirmed','completed') AND deleted_at IS NULL LIMIT 1`).get(tutorId, childId)
      : await db.prepare(`SELECT id FROM bookings WHERE tutor_id = ? AND parent_id = ? AND status IN ('confirmed','completed') AND deleted_at IS NULL LIMIT 1`).get(tutorId, req.user.id);

    if (!relationship) return res.status(403).json({ error: 'No confirmed booking with this tutor' });
  }

  const rows = await db
    .prepare('SELECT * FROM lesson_materials WHERE tutor_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
    .all(tutorId);

  // The tutor who owns the materials, and super_admin, always see the
  // real file_url. A parent/child only sees it for a free material, or
  // a premium one they (the parent) have already purchased.
  if (req.user.role === 'tutor' || req.user.role === 'super_admin') {
    return res.json({ materials: rows });
  }

  const purchases = await db
    .prepare("SELECT material_id FROM material_purchases WHERE buyer_id = ?")
    .all(req.user.role === 'child' ? (await db.prepare('SELECT parent_id FROM children WHERE user_id = ?').get(req.user.id))?.parent_id : req.user.id);
  const purchasedIds = new Set(purchases.map((p) => p.material_id));

  const materials = rows.map((m) => {
    if (!m.is_premium || purchasedIds.has(m.id)) return m;
    return { ...m, file_url: null, locked: true };
  });
  res.json({ materials });
}

/**
 * POST /api/lesson-materials/:id/purchase  (parent)  body: { method? }
 * Buys access to a single premium material. Reuses the configured
 * payment provider directly (not the booking-scoped payments table,
 * since a material purchase isn't tied to a booking).
 */
async function purchase(req, res) {
  if (!['parent', 'adult_student'].includes(req.user.role)) return res.status(403).json({ error: 'Only parents or adult students can purchase materials' });

  const { id } = req.params;
  const material = await db.prepare('SELECT * FROM lesson_materials WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!material) return res.status(404).json({ error: 'Material not found' });
  if (!material.is_premium) return res.status(400).json({ error: 'This material is free — no purchase needed' });

  const existing = await db.prepare('SELECT id FROM material_purchases WHERE material_id = ? AND buyer_id = ?').get(id, req.user.id);
  if (existing) return res.status(400).json({ error: 'Already purchased' });

  const provider = getProvider();
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const reference = `mat_${uuidv4()}`;

  const init = await provider.initializeTransaction({
    amount: material.price,
    currency: material.currency,
    email: user.email || `${user.phone}@no-email.lessonteacher.local`,
    reference,
  });

  // Mock provider: grant immediately (dev/test convenience, same shortcut
  // the booking-payment flow takes with /payments/mock/complete, just
  // inlined here since a one-off purchase doesn't need its own pending state).
  if (provider.name === 'mock') {
    await db
      .prepare('INSERT INTO material_purchases (id, material_id, buyer_id, provider, provider_reference, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), id, req.user.id, provider.name, init.reference, now());
    return res.status(201).json({ ok: true, purchased: true });
  }

  res.status(201).json({ reference: init.reference, authorization_url: init.authorization_url, amount: material.price, currency: material.currency });
}

/** DELETE /api/lesson-materials/:id  (tutor, own material only) */
async function remove(req, res) {
  const { id } = req.params;
  const result = await db
    .prepare('UPDATE lesson_materials SET deleted_at = ?, updated_at = ? WHERE id = ? AND tutor_id = ?')
    .run(now(), now(), id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Material not found' });
  res.json({ ok: true });
}

module.exports = { uploadMiddleware, upload, mine, listForTutor, purchase, remove };
