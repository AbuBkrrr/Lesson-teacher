import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import DevicesAndStorage from '../components/DevicesAndStorage';
import { account, clearSession } from '../api/client';

function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Account() {
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function handleExport() {
    setExporting(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await account.export();
      download(`lesson-teacher-data-export-${new Date().toISOString().slice(0, 10)}.json`, data);
      setSuccess('Your data export has downloaded.');
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete(e) {
    e.preventDefault();
    setDeleting(true);
    setError(null);
    try {
      await account.delete(password);
      clearSession();
      navigate('/login');
    } catch (e) {
      setError(e.message);
      setDeleting(false);
    }
  }

  return (
    <Layout>
      <h1>Account</h1>
      <p>Export your data, or permanently delete your account.</p>

      {error && <div className="lt-error-banner">{error}</div>}
      {success && <div className="lt-success-banner">{success}</div>}

      <div className="lt-card" style={{ maxWidth: 520, marginBottom: 16 }}>
        <h3>Download your data</h3>
        <p className="lt-helper-text">
          Get a JSON file of your profile, bookings, payments, reviews, and messages you've sent.
        </p>
        <button className="lt-btn" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Preparing…' : 'Export my data'}
        </button>
      </div>

      <div className="lt-card" style={{ maxWidth: 520, borderColor: 'var(--lt-danger-fg)' }}>
        <h3 style={{ color: 'var(--lt-danger-fg)' }}>Delete account</h3>
        <p className="lt-helper-text">
          This permanently deactivates your account and clears your contact details. It can't be undone.
        </p>
        {!confirmOpen ? (
          <button className="lt-btn lt-btn--danger" onClick={() => setConfirmOpen(true)}>Delete my account</button>
        ) : (
          <form onSubmit={handleDelete}>
            <div className="lt-field">
              <label htmlFor="confirmPassword">Enter your password to confirm</label>
              <input id="confirmPassword" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </div>
            <div className="lt-row">
              <button type="submit" className="lt-btn lt-btn--danger" disabled={deleting}>
                {deleting ? 'Deleting…' : 'Confirm permanent deletion'}
              </button>
              <button type="button" className="lt-btn lt-btn--ghost" onClick={() => setConfirmOpen(false)}>Cancel</button>
            </div>
          </form>
        )}
      </div>
      <DevicesAndStorage />
    </Layout>
  );
}
