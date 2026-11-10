const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');

function now() {
  return new Date().toISOString();
}

/**
 * Records one admin action. Fire-and-forget from the caller's perspective
 * (await it, but a logging failure should never be allowed to mask or
 * replace the real error from the action itself — callers call this
 * after the action succeeds, not instead of it).
 */
async function logAdminAction(adminId, action, { targetType = null, targetId = null, details = null } = {}) {
  await db.prepare(
    `INSERT INTO admin_audit_log (id, admin_id, action, target_type, target_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(uuidv4(), adminId, action, targetType, targetId, details ? JSON.stringify(details) : null, now());
}

module.exports = { logAdminAction };
