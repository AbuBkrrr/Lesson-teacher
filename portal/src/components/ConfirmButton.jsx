import React, { useEffect, useState } from 'react';

/**
 * Two-step button for destructive actions: first click asks "Sure?", second
 * click runs it. Reverts after 5s or on blur, so a stray click never deletes.
 * Replaces window.confirm (blocked in some webviews, inaccessible to styling).
 */
export default function ConfirmButton({ onConfirm, children, confirmLabel = 'Yes, confirm', className = 'lt-btn lt-btn--sm lt-btn--danger', disabled, label }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return undefined;
    const t = setTimeout(() => setAsking(false), 5000);
    return () => clearTimeout(t);
  }, [asking]);

  if (!asking) {
    return (
      <button type="button" className={className} disabled={disabled} aria-label={label} onClick={() => setAsking(true)}>
        {children}
      </button>
    );
  }
  return (
    <span role="group" aria-label="Confirm action" style={{ display: 'inline-flex', gap: 6 }}>
      <button type="button" className={className} autoFocus onClick={() => { setAsking(false); onConfirm(); }}>{confirmLabel}</button>
      <button type="button" className="lt-btn lt-btn--sm lt-btn--ghost" onClick={() => setAsking(false)}>Keep</button>
    </span>
  );
}
