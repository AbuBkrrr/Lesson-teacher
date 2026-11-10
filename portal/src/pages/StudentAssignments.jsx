import React, { useEffect, useState } from 'react';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import { assignments } from '../api/client';

export default function StudentAssignments() {
  const [list, setList] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busyId, setBusyId] = useState(null);

  const load = () => assignments.mine().then((d) => setList(d.assignments)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  useRefreshOnFocus(load);

  async function handleSubmit(id) {
    const content = drafts[id];
    if (!content?.trim()) return;
    setBusyId(id);
    setError(null);
    setSuccess(null);
    try {
      await assignments.submit(id, { content: content.trim() });
      setSuccess('Submitted!');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Layout>
      <h1>Assignments</h1>
      <p>Work your tutor has sent, and anything they've graded.</p>

      {error && <div className="lt-error-banner">{error}</div>}
      {success && <div className="lt-success-banner">{success}</div>}

      <div className="lt-card">
        {list.map((a) => (
          <div key={a.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--lt-border)' }}>
            <div className="lt-row-between">
              <div>
                <strong>{a.title}</strong> — {a.tutor_name}{a.child_name ? ` (${a.child_name})` : ''}
                {a.instructions && <p className="lt-helper-text" style={{ margin: '4px 0 0 0' }}>{a.instructions}</p>}
                {a.due_at && <p className="lt-helper-text" style={{ margin: '4px 0 0 0', fontSize: '0.8rem' }}>Due {new Date(a.due_at).toLocaleDateString()}</p>}
              </div>
              <StatusBadge status={a.status} />
            </div>

            {a.status === 'assigned' && (
              <div style={{ marginTop: 8 }}>
                <textarea
                  rows={3}
                  placeholder="Type your answer here…"
                  value={drafts[a.id] || ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
                  style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid var(--lt-border)' }}
                />
                <button className="lt-btn lt-btn--sm" style={{ marginTop: 6 }} disabled={busyId === a.id} onClick={() => handleSubmit(a.id)}>
                  Submit
                </button>
              </div>
            )}
            {a.status === 'submitted' && <p className="lt-helper-text" style={{ marginTop: 8 }}>Waiting for your tutor to grade this.</p>}
            {a.status === 'graded' && (
              <p className="lt-helper-text" style={{ marginTop: 8 }}>Grade: <strong>{a.grade}</strong>{a.feedback && ` — ${a.feedback}`}</p>
            )}
          </div>
        ))}
        {list.length === 0 && <div className="lt-empty">No assignments yet.</div>}
      </div>
    </Layout>
  );
}
