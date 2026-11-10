// Dev/test default — see consoleProvider.js under email/ for the same
// rationale. No network call; genuinely exercised in tests.
async function send({ to, body }) {
  console.log(`[sms:console] to=${to}\n${body}`);
  return { ok: true };
}

module.exports = { send };
