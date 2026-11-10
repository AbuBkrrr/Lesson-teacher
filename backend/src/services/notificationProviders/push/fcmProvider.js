// Real Firebase Cloud Messaging integration — covers Android and web
// push directly, and iOS push too (Expo/React Native apps send APNs
// pushes through FCM rather than talking to Apple's servers directly,
// which is why one provider covers all three platforms here). Like the
// other real providers in this codebase, NOT exercised against a live
// Firebase project in this sandbox — no credentials configured, and
// this environment's network doesn't reach Google's APIs. Written
// directly against the documented firebase-admin SDK. Test against a
// real Firebase project before relying on it.

let app = null;
function getApp() {
  if (app) return app;
  const admin = require('firebase-admin');
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON must be set (the Firebase service account JSON, as a single-line string) to use NOTIFICATION_PUSH_PROVIDER=fcm');
  }
  const credential = admin.credential.cert(JSON.parse(raw));
  app = admin.apps.length ? admin.app() : admin.initializeApp({ credential });
  return app;
}

/** `to` is the recipient's FCM/Expo device token (see push_tokens table). */
async function send({ to, subject, body }) {
  const admin = require('firebase-admin');
  getApp();
  await admin.messaging().send({
    token: to,
    notification: { title: subject || 'Lesson Teacher', body },
  });
  return { ok: true };
}

module.exports = { send };
