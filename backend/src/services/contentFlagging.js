// Basic pattern-based flagging for messages between a child and a
// tutor. This catches the crudest, most common red flags — it is NOT
// a substitute for real trust-and-safety infrastructure (human review
// queues, ML classifiers, escalation workflows), which any platform
// actually operating at scale with child users needs to build
// separately. What this DOES do: nothing here is silent — every flag
// is surfaced to the parent and to Super Admin, never just logged and
// forgotten.

const PATTERNS = [
  { reason: 'possible phone number shared', regex: /\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/ },
  { reason: 'possible off-platform contact request', regex: /\b(whatsapp|telegram|instagram|snapchat|my number|call me|text me|outside (this|the) app)\b/i },
  { reason: 'possible secrecy request', regex: /\b(don'?t tell|keep (this|it) (a )?secret|between us|our little secret)\b/i },
  { reason: 'possible request to meet in person', regex: /\b(meet (me )?(in person|somewhere|alone)|come (to my|over))\b/i },
  { reason: 'possible request for personal info', regex: /\b(where do you live|your address|send (me )?a (photo|picture|pic) of yourself)\b/i },
];

function checkMessage(content) {
  for (const { reason, regex } of PATTERNS) {
    if (regex.test(content)) return reason;
  }
  return null;
}

module.exports = { checkMessage };
