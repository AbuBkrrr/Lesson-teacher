// Real Twilio integration. Like the other real providers in this
// codebase, NOT exercised against a live Twilio account in this sandbox
// — no account configured, and this environment's network doesn't reach
// api.twilio.com. Written directly against Twilio's documented Node SDK.
// Test against a real (or Twilio trial) account before relying on it.

const twilio = require('twilio');

let client = null;
function getClient() {
  if (client) return client;
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must both be set to use NOTIFICATION_SMS_PROVIDER=twilio');
  }
  client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return client;
}

async function send({ to, body }) {
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) throw new Error('TWILIO_FROM_NUMBER must be set to use NOTIFICATION_SMS_PROVIDER=twilio');
  await getClient().messages.create({ to, from, body });
  return { ok: true };
}

module.exports = { send };
