import { useEffect, useRef } from 'react';

// Re-runs `fn` when the tab regains focus/visibility (and at most once per 5s),
// so list pages don't show stale data after changes made elsewhere.
export default function useRefreshOnFocus(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let last = Date.now();
    const run = () => {
      if (document.visibilityState === 'hidden' || Date.now() - last < 5000) return;
      last = Date.now();
      ref.current();
    };
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => { window.removeEventListener('focus', run); document.removeEventListener('visibilitychange', run); };
  }, []);
}
