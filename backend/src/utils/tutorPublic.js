/** Fields on tutor_profiles that must never reach other users (payout destination). */
const PRIVATE_TUTOR_FIELDS = ['bank_name', 'bank_code', 'account_number', 'account_name', 'payout_provider', 'payout_recipient_code'];

function publicTutorProfile(row) {
  const out = { ...row };
  for (const f of PRIVATE_TUTOR_FIELDS) delete out[f];
  return out;
}

module.exports = { publicTutorProfile, PRIVATE_TUTOR_FIELDS };
