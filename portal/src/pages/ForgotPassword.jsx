import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../api/client';

export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword(identifier.trim());
      // Always show the same confirmation, whether or not the identifier
      // matched an account — the backend responds identically either way
      // so this page never reveals which emails/phones have accounts.
      setSent(true);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lt-auth-screen">
      <div className="lt-auth-card">
        <div className="lt-auth-logo">Lesson Teacher</div>
        <div className="lt-auth-tagline">Reset your password</div>

        {error && <div className="lt-error-banner">{error}</div>}

        {sent ? (
          <p>
            If an account matches <strong>{identifier}</strong>, we've sent reset instructions to it.
            Check your email (or SMS) and follow the link to choose a new password.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="lt-field">
              <label htmlFor="identifier">Email, phone, or username</label>
              <input
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <button className="lt-btn" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
              {submitting ? 'Sending...' : 'Send reset instructions'}
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
