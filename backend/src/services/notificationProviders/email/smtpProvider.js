// Real SMTP integration via nodemailer. Covered by
// tests/integration/notificationProviders.test.js against a local SMTP server
// (auth, envelope addresses, subject, body). It has NOT been run against a real
// mail provider — TLS/STARTTLS negotiation, provider rate limits and
// deliverability (SPF/DKIM) still need a staging check with real credentials.

const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP_HOST, SMTP_USER, and SMTP_PASS must all be set to use NOTIFICATION_EMAIL_PROVIDER=smtp');
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

async function send({ to, subject, body }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await getTransporter().sendMail({ from, to, subject, text: body });
  return { ok: true };
}

module.exports = { send };
