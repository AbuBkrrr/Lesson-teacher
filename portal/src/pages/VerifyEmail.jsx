import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { verifyEmail } from '../api/client';

export default function VerifyEmail() {
  // HashRouter: the token rides after the hash route, e.g.
  // /#/verify-email?token=abc123 — read it off location.hash, same as
  // ResetPassword does, since useSearchParams only sees params before the hash.
  const token = useMemo(() => {
    const hash = window.location.hash || '';
    const queryIndex = hash.indexOf('?');
    if (queryIndex === -1) return '';
    return new URLSearchParams(hash.slice(queryIndex + 1)).get('token') || '';
  }, []);

  const [status, setStatus] = useState('pending'); // 'pending' | 'done' | 'error'
  const [error, setError] = useState(null);

  // The token is single-use. React StrictMode (dev) runs effects twice, and a
  // second call would fail and overwrite the success state, so only verify once.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      setStatus('error');
      setError('This verification link is missing its token.');
      return;
    }
    verifyEmail(token)
      .then(() => setStatus('done'))
      .catch((err) => {
        setStatus('error');
        setError(err.message || 'This verification link is invalid or has expired.');
      });
  }, [token]);

  return (
    <div className="lt-auth-screen">
      <div className="lt-auth-card">
        <div className="lt-auth-logo">Lesson Teacher</div>
        <div className="lt-auth-tagline">Email verification</div>

        {status === 'pending' && <p>Verifying your email...</p>}
        {status === 'done' && <p>Your email address is verified. Thanks!</p>}
        {status === 'error' && <div className="lt-error-banner">{error}</div>}

        <p style={{ marginTop: 16, fontSize: '0.85rem' }}>
          <Link to="/login">← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
