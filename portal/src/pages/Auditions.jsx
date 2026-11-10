import React, { useEffect, useState } from 'react';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import { auditions } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export default function Auditions() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [videoUrls, setVideoUrls] = useState({});

  const load = () => auditions.mine().then((d) => setRows(d.auditions)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  useRefreshOnFocus(load);

  async function updateStatus(id, status) {
    setBusyId(id);
    setError(null);
    try {
      await auditions.updateStatus(id, status, videoUrls[id]);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const otherPartyLabel = user?.role === 'tutor' ? 'Parent' : 'Tutor';

  return (
    <Layout>
      <h1>Auditions</h1>
      <p>{user?.role === 'tutor' ? 'Audition requests from parents, before they book a full session.' : 'Your audition requests with tutors.'}</p>

      {error && <div className="lt-error-banner">{error}</div>}

      <div className="lt-card">
        <table className="lt-table">
          <thead>
            <tr><th>{otherPartyLabel}</th><th>Video</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>{user?.role === 'tutor' ? a.parent_name : a.tutor_name}</td>
                <td>{a.video_url ? <a href={a.video_url} target="_blank" rel="noreferrer">Watch</a> : '—'}</td>
                <td><StatusBadge status={a.status} /></td>
                <td>
                  {user?.role === 'tutor' && a.status === 'pending' && (
                    <div className="lt-row">
                      <input
                        aria-label="Audition video link"
                        placeholder="Video link (https://…)"
                        value={videoUrls[a.id] || ''}
                        onChange={(e) => setVideoUrls((v) => ({ ...v, [a.id]: e.target.value }))}
                        style={{ padding: 6, borderRadius: 8, border: '1px solid var(--lt-border)', width: 160 }}
                      />
                      <button className="lt-btn lt-btn--sm" disabled={busyId === a.id} onClick={() => updateStatus(a.id, 'ready')}>Mark ready</button>
                      <button className="lt-btn lt-btn--sm lt-btn--danger" disabled={busyId === a.id} onClick={() => updateStatus(a.id, 'declined')}>Decline</button>
                    </div>
                  )}
                  {user?.role !== 'tutor' && ['ready', 'completed'].includes(a.status) && (
                    <Link className="lt-btn lt-btn--sm" to="/parent/browse">Book a session</Link>
                  )}
                  {user?.role === 'tutor' && a.status === 'ready' && (
                    <button className="lt-btn lt-btn--sm" disabled={busyId === a.id} onClick={() => updateStatus(a.id, 'completed')}>Mark completed</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="lt-empty">No auditions yet.</div>}
      </div>
    </Layout>
  );
}
