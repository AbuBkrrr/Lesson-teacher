import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { kyc } from '../../api/client';

export default function Verifications() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [reasonById, setReasonById] = useState({});

  async function load() {
    const data = await kyc.pending();
    setUsers(data.users);
  }
  useEffect(() => { load(); }, []);

  async function approve(id) {
    setError(null);
    try {
      await kyc.approve(id);
      await load();
    } catch (err) {
      setError(err.message || 'Could not approve');
    }
  }

  async function reject(id) {
    const reason = reasonById[id];
    if (!reason) { setError('Enter a rejection reason first'); return; }
    setError(null);
    try {
      await kyc.reject(id, reason);
      await load();
    } catch (err) {
      setError(err.message || 'Could not reject');
    }
  }

  return (
    <Layout>
      <div className="lt-page">
        <h1>ID verification queue</h1>
        <p className="lt-muted">Review uploaded identity documents. Approving unlocks bookings, auditions, and payouts for that account.</p>
        {error && <div className="lt-error-banner">{error}</div>}

        {users.length === 0 && <p className="lt-muted">Nothing pending review.</p>}

        {users.map((u) => (
          <div key={u.id} className="lt-card">
            <strong>{u.full_name}</strong> <span className="lt-muted">({u.role}, {u.email})</span>
            <p>Document: {u.id_document_type || 'Didit session'}{u.didit_session_id ? ` — Didit session ${u.didit_session_id}` : ''}</p>
            {u.id_document_url && (
              <p><a href={u.id_document_url} target="_blank" rel="noreferrer">View uploaded document</a></p>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="lt-btn" onClick={() => approve(u.id)}>Approve</button>
              <input
                aria-label="Rejection reason"
                placeholder="Rejection reason"
                value={reasonById[u.id] || ''}
                onChange={(e) => setReasonById((m) => ({ ...m, [u.id]: e.target.value }))}
                style={{ flex: 1, minWidth: 160 }}
              />
              <button className="lt-btn lt-btn--secondary" onClick={() => reject(u.id)}>Reject</button>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
