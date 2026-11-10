import React, { useEffect, useState } from 'react';
import useRefreshOnFocus from '../../hooks/useRefreshOnFocus';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';
import { assignments, bookings } from '../../api/client';

export default function TutorAssignments() {
  const [list, setList] = useState([]);
  const [bookedChildren, setBookedChildren] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [form, setForm] = useState({ child_id: '', title: '', instructions: '', due_at: '' });
  const [saving, setSaving] = useState(false);
  const [gradeDrafts, setGradeDrafts] = useState({});

  const load = () => assignments.mine().then((d) => setList(d.assignments)).catch((e) => setError(e.message));
  useRefreshOnFocus(load);
  useEffect(() => {
    load();
    bookings.mine().then((d) => {
      const seen = new Map();
      d.bookings.filter((b) => ['confirmed', 'completed'].includes(b.status)).forEach((b) => {
        const key = b.child_id ? `c:${b.child_id}` : `u:${b.parent_id}`;
        if (!seen.has(key)) seen.set(key, b.child_id ? b.child_name : `${b.parent_name} (adult student)`);
      });
      setBookedChildren([...seen.entries()].map(([id, name]) => ({ id, name })));
    }).catch(() => {});
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.child_id || !form.title) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { child_id: target, ...rest } = form;
      const [kind, id] = target.split(':');
      await assignments.create({ ...rest, [kind === 'c' ? 'child_id' : 'student_user_id']: id });
      setForm({ child_id: '', title: '', instructions: '', due_at: '' });
      setSuccess('Assignment sent.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleGrade(id) {
    const draft = gradeDrafts[id];
    if (!draft?.grade) return;
    setError(null);
    try {
      await assignments.grade(id, draft);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Layout>
      <h1>Assignments</h1>
      <p>Assign work to students you've had a confirmed booking with, and grade what comes back.</p>

      {error && <div className="lt-error-banner">{error}</div>}
      {success && <div className="lt-success-banner">{success}</div>}

      <div className="lt-card" style={{ maxWidth: 480 }}>
        <h3>New assignment</h3>
        <form onSubmit={handleCreate}>
          <div className="lt-field">
            <label htmlFor="assignments-f1">Student</label>
            <select id="assignments-f1" value={form.child_id} onChange={(e) => setForm((f) => ({ ...f, child_id: e.target.value }))} required>
              <option value="">— Select —</option>
              {bookedChildren.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="lt-field">
            <label htmlFor="assignments-title">Title</label>
            <input id="assignments-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
          </div>
          <div className="lt-field">
            <label htmlFor="assignments-f2">Instructions</label>
            <textarea id="assignments-f2" rows={3} value={form.instructions} onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))} />
          </div>
          <div className="lt-field">
            <label htmlFor="assignments-f3">Due date (optional)</label>
            <input id="assignments-f3" type="date" value={form.due_at} onChange={(e) => setForm((f) => ({ ...f, due_at: e.target.value }))} />
          </div>
          <button className="lt-btn" type="submit" disabled={saving}>{saving ? 'Sending…' : 'Send assignment'}</button>
        </form>
      </div>

      <div className="lt-card" style={{ marginTop: 16 }}>
        {list.map((a) => (
          <div key={a.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--lt-border)' }}>
            <div className="lt-row-between">
              <div>
                <strong>{a.title}</strong> — {a.child_name}
                {a.instructions && <p className="lt-helper-text" style={{ margin: '4px 0 0 0' }}>{a.instructions}</p>}
              </div>
              <StatusBadge status={a.status} />
            </div>

            {a.status === 'submitted' && (
              <div className="lt-row" style={{ marginTop: 8 }}>
                <p style={{ margin: 0, flex: 1 }}>{a.submission_content || <a href={a.submission_file_url} target="_blank" rel="noreferrer">View submission</a>}</p>
                <input
                  placeholder="Grade (e.g. A, 95%)"
                  value={gradeDrafts[a.id]?.grade || ''}
                  onChange={(e) => setGradeDrafts((d) => ({ ...d, [a.id]: { ...d[a.id], grade: e.target.value } }))}
                  style={{ width: 140, padding: 6, borderRadius: 8, border: '1px solid var(--lt-border)' }}
                />
                <button className="lt-btn lt-btn--sm" onClick={() => handleGrade(a.id)}>Grade</button>
              </div>
            )}
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
