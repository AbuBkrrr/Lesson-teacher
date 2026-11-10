// Dev/test default — see consoleProvider.js under email/ for the same
// rationale. No network call; genuinely exercised in tests.
async function send({ to, subject, body }) {
  console.log(`[push:console] to=${to} subject="${subject || ''}"\n${body}`);
  return { ok: true };
}

module.exports = { send };
