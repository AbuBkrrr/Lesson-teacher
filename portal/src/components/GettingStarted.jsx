import React, { useState } from 'react';
import { Link } from 'react-router-dom';

/** Onboarding checklist. steps: [{ label, done, to }]. Hides itself once every
 * step is done or the user dismisses it (remembered per key, best-effort). */
export default function GettingStarted({ storageKey, steps }) {
  const key = `ltp_onboarding_dismissed_${storageKey}`;
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
  });
  const doneCount = steps.filter((s) => s.done).length;
  if (dismissed || doneCount === steps.length) return null;

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(key, '1'); } catch { /* ignore */ }
  }

  return (
    <div className="lt-card" data-testid="getting-started" style={{ marginBottom: 16, borderColor: 'var(--lt-primary)' }}>
      <div className="lt-row-between">
        <h3 style={{ margin: 0 }}>Getting started ({doneCount}/{steps.length})</h3>
        <button className="lt-btn lt-btn--sm" onClick={dismiss}>Dismiss</button>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
        {steps.map((s) => (
          <li key={s.label} style={{ padding: '4px 0', color: s.done ? 'var(--lt-muted)' : 'inherit' }}>
            <span aria-hidden="true">{s.done ? '✅' : '⬜'}</span>{' '}
            {s.done ? <s>{s.label}</s> : <Link to={s.to}>{s.label} →</Link>}
          </li>
        ))}
      </ul>
    </div>
  );
}
