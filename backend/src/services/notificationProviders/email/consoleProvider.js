// Dev/test default. Doesn't make a network call — logs the email so it's
// visible while developing, and lets the caller record it in the
// notifications table the same way a real send would. This is genuinely
// exercised in tests (unlike smtpProvider.js), the same way mockProvider.js
// is for payments.
async function send({ to, subject, body }) {
  console.log(`[email:console] to=${to} subject="${subject}"\n${body}`);
  return { ok: true };
}

module.exports = { send };
