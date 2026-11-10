// Didit identity-verification integration. This sandbox can't reach
// the live Didit API (network here is restricted to npm/GitHub/PyPI),
// so this has NOT been exercised against the real API — it's written
// against Didit's documented REST endpoints and response shapes. Test
// against Didit's sandbox workflow before going live.
//
// Didit runs its own automated/semi-automated document + liveness
// check and reports a session outcome via webhook. That outcome is
// NOT treated as final platform approval on its own: it only moves
// the user's id_verification_status to 'pending' (if Didit approved)
// or 'rejected' (if Didit declined), and a super_admin still has to
// approve a 'pending' user before the hard gate opens — this keeps
// the existing "no auto-verification" safety property while using
// Didit to do the document/liveness work instead of a human reviewing
// raw ID photos directly.

const DIDIT_BASE = process.env.DIDIT_BASE_URL || 'https://verification.didit.me/v2';

function apiKey() {
  const key = process.env.DIDIT_API_KEY;
  if (!key) throw new Error('DIDIT_API_KEY is not set');
  return key;
}

async function diditFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${DIDIT_BASE}${path}`, {
    method,
    headers: {
      'x-api-key': apiKey(),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.message || 'Didit request failed');
    err.didit = data;
    throw err;
  }
  return data;
}

/**
 * Creates a Didit verification session and returns the hosted URL the
 * user completes the document/liveness check in (returned to the
 * client; the session_id is stored on the user so the webhook below
 * can be matched back to them).
 */
async function createSession({ userId, callbackUrl, workflowId }) {
  const data = await diditFetch('/session/', {
    method: 'POST',
    body: {
      workflow_id: workflowId || process.env.DIDIT_WORKFLOW_ID,
      vendor_data: userId,
      callback: callbackUrl,
    },
  });
  return { session_id: data.session_id, verification_url: data.url };
}

async function getSessionStatus(sessionId) {
  const data = await diditFetch(`/session/${encodeURIComponent(sessionId)}/decision/`);
  // Didit statuses: 'Not Started' | 'In Progress' | 'Approved' | 'Declined' | 'In Review'
  const mapped = data.status === 'Approved' ? 'approved' : data.status === 'Declined' ? 'declined' : 'pending';
  return { status: mapped, raw: data };
}

/** Verifies the webhook signature Didit sends on session status changes. */
function verifyWebhookSignature(rawBody, signatureHeader) {
  const crypto = require('crypto');
  const secret = process.env.DIDIT_WEBHOOK_SECRET;
  if (!secret) throw new Error('DIDIT_WEBHOOK_SECRET is not set');
  const hash = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return hash === signatureHeader;
}

module.exports = { createSession, getSessionStatus, verifyWebhookSignature };
