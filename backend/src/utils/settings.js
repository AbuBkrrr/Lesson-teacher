const db = require('../config/db');

const DEFAULTS = {
  commission_percent: '15', // platform keeps 15% of every booking payment by default
  // Shown to parents who choose "Direct transfer" at checkout, as the account to pay into.
  transfer_bank_name: '',
  transfer_account_number: '',
  transfer_account_name: '',
  // Growth features (see schema.postgres.sql "Growth & engagement features").
  sibling_discount_percent: '10',       // applied when a parent has 2+ active children, at checkout
  satisfaction_guarantee_hours: '48',   // window after a completed lesson to request a refund/reschedule
  instant_payout_fee_percent: '2',      // fee charged for an instant (vs. standard batch) payout
};

function now() {
  return new Date().toISOString();
}

async function getSetting(key) {
  const row = await db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULTS[key];
}

async function setSetting(key, value) {
  await db.prepare(
    `INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, String(value), now());
}

async function getCommissionPercent() {
  return Number(await getSetting('commission_percent'));
}

module.exports = { getSetting, setSetting, getCommissionPercent, DEFAULTS };
