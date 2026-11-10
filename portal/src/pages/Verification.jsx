import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { kyc } from '../api/client';

const STATUS_COPY = {
  unverified: { label: 'Not verified', tone: 'warn', desc: 'Upload a valid ID to unlock bookings, auditions, and payouts.' },
  pending: { label: 'Pending review', tone: 'info', desc: 'Your document was received and is awaiting approval.' },
  verified: { label: 'Verified', tone: 'ok', desc: 'You’re fully verified — bookings and auditions are unlocked.' },
  rejected: { label: 'Rejected', tone: 'error', desc: 'Your last submission was rejected. See the reason below and re-upload.' },
};

export default function Verification() {
  const [status, setStatus] = useState(null);
  const [docType, setDocType] = useState('national_id');
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await kyc.myStatus();
    setStatus(data);
  }
  useEffect(() => { load(); }, []);

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) { setError('Choose a file first'); return; }
    setError(null);
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('document_type', docType);
      await kyc.uploadDocument(formData);
      await load();
      setFile(null);
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDidit() {
    setError(null);
    setBusy(true);
    try {
      const { verification_url } = await kyc.startDiditSession();
      window.open(verification_url, '_blank', 'noopener');
    } catch (err) {
      setError(err.message || 'Could not start Didit verification');
    } finally {
      setBusy(false);
    }
  }

  const copy = status ? STATUS_COPY[status.id_verification_status] : null;

  return (
    <Layout>
      <div className="lt-page">
        <h1>Identity verification</h1>
        <p className="lt-muted">
          Every user must verify their identity before booking, teaching, or receiving a payout — this keeps the platform safe for everyone.
        </p>

        {error && <div className="lt-error-banner">{error}</div>}

        {copy && (
          <div className={`lt-card lt-status-${copy.tone}`}>
            <strong>{copy.label}</strong>
            <p>{copy.desc}</p>
            {status.id_rejection_reason && <p style={{ color: '#b91c1c' }}>Reason: {status.id_rejection_reason}</p>}
          </div>
        )}

        {status && status.id_verification_status !== 'verified' && status.id_verification_status !== 'pending' && (
          <>
            <div className="lt-card">
              <h3>Quick verify with Didit</h3>
              <p className="lt-muted">Complete a guided document + selfie check in a new tab.</p>
              <button className="lt-btn" onClick={handleDidit} disabled={busy}>Start Didit verification</button>
            </div>

            <div className="lt-card">
              <h3>Or upload your ID manually</h3>
              <form onSubmit={handleUpload}>
                <div className="lt-field">
                  <label htmlFor="docType">Document type</label>
                  <select id="docType" value={docType} onChange={(e) => setDocType(e.target.value)}>
                    <option value="national_id">National ID</option>
                    <option value="passport">Passport</option>
                    <option value="drivers_license">Driver's License</option>
                  </select>
                </div>
                <div className="lt-field">
                  <label htmlFor="file">ID photo/scan</label>
                  <input id="file" type="file" accept="image/*,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                </div>
                <button className="lt-btn" type="submit" disabled={busy}>{busy ? 'Uploading...' : 'Upload for review'}</button>
              </form>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
