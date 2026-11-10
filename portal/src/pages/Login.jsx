import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { childInvites, consumeSessionExpired, deviceLink } from '../api/client';

const HOME_BY_ROLE = {
  super_admin: '/superadmin',
  school_admin: '/school',
  tutor: '/tutor',
  parent: '/parent',
  child: '/assignments',
};

export default function Login() {
  const { login, setUserFromSession } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' | 'redeem'

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [childPassword, setChildPassword] = useState('');

  const [error, setError] = useState(() => (() => { const why = consumeSessionExpired(); return why === 'suspended' ? 'This account has been suspended. Contact support if you think this is a mistake.' : why ? 'Your session expired. Please sign in again.' : null; })());

  const [submitting, setSubmitting] = useState(false);
  const [link, setLink] = useState(null); // { code, secret } while waiting for another device to approve

  useEffect(() => {
    if (!link) return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const data = await deviceLink.claim(link.code, link.secret);
        if (stop || !data) return;
        stop = true;
        setUserFromSession(data.user);
        navigate(HOME_BY_ROLE[data.user.role] || '/');
      } catch (err) { if (!stop) { stop = true; setLink(null); setError(err.message || 'Link failed'); } }
    };
    const t = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [link, navigate, setUserFromSession]);

  async function startLink() {
    setError(null);
    try { setLink(await deviceLink.start()); } catch (err) { setError(err.message); }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(identifier, password);
      navigate(HOME_BY_ROLE[user.role] || '/');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRedeem(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await childInvites.redeem(code.trim(), username.trim(), childPassword);
      setUserFromSession(data.user);
      navigate('/assignments');
    } catch (err) {
      setError(err.message || 'Could not create your account');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lt-auth-screen">
      <div className="lt-auth-card">
        <div className="lt-auth-logo">Lesson Teacher</div>
        <div className="lt-auth-tagline">{mode === 'login' ? 'Sign in to your portal' : 'Set up your student account'}</div>

        {error && <div className="lt-error-banner">{error}</div>}

        {mode === 'login' ? (
          <form onSubmit={handleLogin}>
            <div className="lt-field">
              <label htmlFor="identifier">Email, phone, or username</label>
              <input id="identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" />
            </div>
            <div className="lt-field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <button className="lt-btn" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
            <p style={{ marginTop: 12, fontSize: '0.85rem' }}>
              <Link to="/forgot-password">Forgot your password?</Link>
            </p>
            {link ? (
              <div className="lt-card" style={{ textAlign: 'center' }}>
                <p style={{ margin: 0 }}>On a device where you're signed in, open <strong>Account → Linked devices</strong> and enter:</p>
                <div style={{ fontSize: '1.6rem', letterSpacing: 4, fontWeight: 700, margin: '8px 0' }} data-testid="link-code">{link.code}</div>
                <small className="lt-helper-text">Waiting for approval… the code expires in 2 minutes.</small>
              </div>
            ) : (
              <p style={{ fontSize: '0.85rem' }}><a href="#" onClick={(e) => { e.preventDefault(); startLink(); }}>Sign in with a code from another device</a></p>
            )}
          </form>
        ) : (
          <form onSubmit={handleRedeem}>
            <div className="lt-field">
              <label htmlFor="code">Code from your parent</label>
              <input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. AB12CD" required />
            </div>
            <div className="lt-field">
              <label htmlFor="username">Choose a username</label>
              <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div className="lt-field">
              <label htmlFor="childPassword">Choose a password</label>
              <input id="childPassword" type="password" value={childPassword} onChange={(e) => setChildPassword(e.target.value)} autoComplete="new-password" required />
            </div>
            <button className="lt-btn" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
              {submitting ? 'Creating account...' : 'Create my account'}
            </button>
          </form>
        )}

        <p style={{ marginTop: 16, fontSize: '0.85rem' }}>
          {mode === 'login' ? (
            <>
              A parent gave you a code?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setError(null); setMode('redeem'); }}>Use it here</a>.
            </>
          ) : (
            <a href="#" onClick={(e) => { e.preventDefault(); setError(null); setMode('login'); }}>← Back to sign in</a>
          )}
        </p>

        {mode === 'login' && (
          <p style={{ marginTop: 8, fontSize: '0.85rem' }}>
            New here? <Link to="/signup">Create an account</Link> as a parent, adult student, tutor, or school. Super Admin accounts are created by the platform team.
          </p>
        )}
      </div>
    </div>
  );
}
