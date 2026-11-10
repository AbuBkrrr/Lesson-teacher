import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { resetPassword } from '../api/client';

export default function ResetPassword() {
  const navigate = useNavigate();
  // HashRouter: the token survives as a query string tacked on after the
  // hash route, e.g. /#/reset-password?token=abc123 — read it off
  // location.hash rather than useSearchParams, which only sees params
  // before the hash.
  const token = useMemo(() => {
    const hash = window.location.hash || '';
    const queryIndex = hash.indexOf('?');
    if (queryIndex === -1) return '';
    return new URLSearchParams(hash.slice(queryIndex + 1)).get('token') || '';
  }, []);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError('This reset link is missing its token. Request a new one.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword(token, newPassword);
      setDone(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err.message || 'This reset link is invalid or has expired.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lt-auth-screen">
      <div className="lt-auth-card">
        <div className="lt-auth-logo">Lesson Teacher</div>
        <div className="lt-auth-tagline">Choose a new password</div>

        {error && <div className="lt-error-banner">{error}</div>}

        {done ? (
          <p>Your password has been reset. Redirecting you to sign in...</p>
        ) : !token ? (
          <p>
            This reset link is missing its token.{' '}
            <Link to="/forgot-password">Request a new one</Link>.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="lt-field">
              <label htmlFor="newPassword">New password</label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="lt-field">
              <label htmlFor="confirmPassword">Confirm new password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <button className="lt-btn" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
              {submitting ? 'Resetting...' : 'Reset password'}
            </button>
          </form>
        )}

        <p style={{ marginTop: 16, fontSize: '0.85rem' }}>
          <Link to="/login">← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
