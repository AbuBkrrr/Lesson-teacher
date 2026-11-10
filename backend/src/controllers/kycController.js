const db = require('../config/db');
const { getStorageProvider } = require('../services/storageProviders');
const didit = require('../services/kycProviders/diditProvider');
const { notifyUser, templates } = require('../services/notifications');

function now() {
  return new Date().toISOString();
}

function uploadMiddleware(req, res, next) {
  return getStorageProvider().uploadMiddleware(req, res, next);
}

/**
 * POST /api/kyc/document  (any authenticated user)
 * multipart/form-data: file, document_type (e.g. 'passport', 'national_id', 'drivers_license')
 *
 * Manual fallback path: stores the document and moves the user into
 * 'pending' review. Kept alongside the Didit flow below for cases
 * where a hosted Didit session isn't available/desired.
 */
async function uploadDocument(req, res) {
  if (!req.file) return res.status(400).json({ error: 'A file is required (form field name: file)' });
  const { document_type } = req.body || {};
  if (!document_type) return res.status(400).json({ error: 'document_type is required' });

  const provider = getStorageProvider();
  const { fileUrl } = await provider.describeUploadedFile(req, req.file);

  await db.prepare(
    `UPDATE users SET id_document_type = ?, id_document_url = ?, id_verification_status = 'pending',
       id_rejection_reason = NULL, updated_at = ? WHERE id = ?`
  ).run(document_type, fileUrl, now(), req.user.id);

  res.status(201).json({ id_verification_status: 'pending', id_document_url: fileUrl });
}

/**
 * POST /api/kyc/didit/session  (any authenticated user)
 * Starts a hosted Didit verification session and returns the URL the
 * client should open. The resulting webhook (below) advances the
 * user's status; a super_admin still has final say (see schema note).
 */
async function startDiditSession(req, res) {
  const callbackUrl = process.env.DIDIT_CALLBACK_URL || `${process.env.APP_BASE_URL || ''}/api/kyc/didit/webhook`;
  const session = await didit.createSession({ userId: req.user.id, callbackUrl });

  await db.prepare('UPDATE users SET didit_session_id = ?, updated_at = ? WHERE id = ?')
    .run(session.session_id, now(), req.user.id);

  res.status(201).json({ session_id: session.session_id, verification_url: session.verification_url });
}

/**
 * POST /api/kyc/didit/webhook  (Didit → us, unauthenticated, signature-verified)
 */
async function diditWebhook(req, res) {
  const signature = req.headers['x-signature'] || req.headers['x-didit-signature'];
  const rawBody = req.rawBody || JSON.stringify(req.body);
  if (!didit.verifyWebhookSignature(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const { session_id, status } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id is required' });

  const user = await db.prepare('SELECT id FROM users WHERE didit_session_id = ?').get(session_id);
  if (!user) return res.status(404).json({ error: 'No user matches this session' });

  if (status === 'Approved') {
    // Didit's own check passed; still 'pending' until a super_admin
    // gives final platform approval — never auto-verified.
    await db.prepare(`UPDATE users SET id_verification_status = 'pending', updated_at = ? WHERE id = ?`)
      .run(now(), user.id);
  } else if (status === 'Declined') {
    await db.prepare(
      `UPDATE users SET id_verification_status = 'rejected', id_rejection_reason = ?, updated_at = ? WHERE id = ?`
    ).run('Declined by Didit verification check', now(), user.id);
  }

  res.json({ received: true });
}

/** GET /api/kyc/me  (any authenticated user) */
async function myStatus(req, res) {
  const row = await db.prepare(
    `SELECT id_verification_status, id_document_type, id_rejection_reason, id_verified_at
     FROM users WHERE id = ?`
  ).get(req.user.id);
  res.json(row);
}

/** GET /api/kyc/pending  (super_admin) */
async function listPending(req, res) {
  const rows = await db.prepare(
    `SELECT id, full_name, email, role, id_document_type, id_document_url, didit_session_id, updated_at
     FROM users WHERE id_verification_status = 'pending' ORDER BY updated_at ASC`
  ).all();
  res.json({ users: rows });
}

/** POST /api/kyc/:userId/approve  (super_admin) */
async function approve(req, res) {
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  await db.prepare(
    `UPDATE users SET id_verification_status = 'verified', id_verified_at = ?, id_verified_by = ?,
       id_rejection_reason = NULL, updated_at = ? WHERE id = ?`
  ).run(now(), req.user.id, now(), target.id);

  await notifyUser(target, templates.idVerificationResult(true));
  res.json({ id_verification_status: 'verified' });
}

/** POST /api/kyc/:userId/reject  (super_admin)  body: { reason } */
async function reject(req, res) {
  const { reason } = req.body || {};
  if (!reason) return res.status(400).json({ error: 'reason is required' });

  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  await db.prepare(
    `UPDATE users SET id_verification_status = 'rejected', id_rejection_reason = ?, updated_at = ? WHERE id = ?`
  ).run(reason, now(), target.id);

  await notifyUser(target, templates.idVerificationResult(false, reason));
  res.json({ id_verification_status: 'rejected' });
}

module.exports = {
  uploadMiddleware,
  uploadDocument,
  startDiditSession,
  diditWebhook,
  myStatus,
  listPending,
  approve,
  reject,
};
