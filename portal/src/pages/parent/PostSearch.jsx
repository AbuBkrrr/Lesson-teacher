import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import ConfirmButton from '../../components/ConfirmButton';
import { lessonRequests, children } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

export default function PostSearch() {
  const { user } = useAuth();
  const [kids, setKids] = useState([]);
  useEffect(() => { if (user?.role === 'parent') children.mine().then((d) => setKids(d.children)).catch(() => {}); }, [user]);
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', city: '', online: true, min_budget: '', max_budget: '', child_id: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await lessonRequests.mine();
    setRequests(data.lesson_requests);
  }
  useEffect(() => { load(); }, []);

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handlePost(e) {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required'); return; }
    setError(null);
    setBusy(true);
    try {
      await lessonRequests.create({
        ...form,
        child_id: form.child_id || undefined,
        min_budget: form.min_budget ? Number(form.min_budget) : undefined,
        max_budget: form.max_budget ? Number(form.max_budget) : undefined,
      });
      setForm({ title: '', description: '', city: '', online: true, min_budget: '', max_budget: '', child_id: '' });
      await load();
    } catch (err) {
      setError(err.message || 'Could not post request');
    } finally {
      setBusy(false);
    }
  }

  async function acceptApp(requestId, appId) {
    setError(null);
    try {
      await lessonRequests.acceptApplication(requestId, appId);
      await load();
    } catch (err) {
      setError(err.message || 'Could not accept application');
    }
  }

  async function declineApp(requestId, appId) {
    setError(null);
    try {
      await lessonRequests.declineApplication(requestId, appId);
      await load();
    } catch (err) {
      setError(err.message || 'Could not decline application');
    }
  }

  async function closeRequest(id) {
    setError(null);
    try {
      await lessonRequests.close(id);
      await load();
    } catch (err) {
      setError(err.message || 'Could not close request');
    }
  }

  return (
    <Layout>
      <div className="lt-page">
        <h1>Post a search</h1>
        <p className="lt-muted">Can't find the right tutor browsing? Post what you need and let tutors apply to you.</p>
        {error && <div className="lt-error-banner">{error}</div>}

        <div className="lt-card">
          <h3>New request</h3>
          <form onSubmit={handlePost}>
            {kids.length > 0 && (
              <div className="lt-field">
                <label htmlFor="req_child">Which child is this for? (optional)</label>
                <select id="req_child" value={form.child_id} onChange={(e) => setField('child_id', e.target.value)}>
                  <option value="">— Select —</option>
                  {kids.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
              </div>
            )}
            <div className="lt-field">
              <label htmlFor="title">What do you need help with?</label>
              <input id="title" value={form.title} onChange={(e) => setField('title', e.target.value)} placeholder="e.g. SS2 Further Maths twice a week" required />
            </div>
            <div className="lt-field">
              <label htmlFor="description">Details (optional)</label>
              <textarea id="description" value={form.description} onChange={(e) => setField('description', e.target.value)} rows={3} />
            </div>
            <div className="lt-field">
              <label htmlFor="city">City</label>
              <input id="city" value={form.city} onChange={(e) => setField('city', e.target.value)} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input type="checkbox" checked={form.online} onChange={(e) => setField('online', e.target.checked)} /> Online is fine
            </label>
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="lt-field" style={{ flex: 1 }}>
                <label htmlFor="min_budget">Min budget</label>
                <input id="min_budget" type="number" value={form.min_budget} onChange={(e) => setField('min_budget', e.target.value)} />
              </div>
              <div className="lt-field" style={{ flex: 1 }}>
                <label htmlFor="max_budget">Max budget</label>
                <input id="max_budget" type="number" value={form.max_budget} onChange={(e) => setField('max_budget', e.target.value)} />
              </div>
            </div>
            <button className="lt-btn" type="submit" disabled={busy}>{busy ? 'Posting...' : 'Post request'}</button>
          </form>
        </div>

        <h2>Your requests</h2>
        {requests.length === 0 && <p className="lt-muted">You haven't posted any requests yet.</p>}
        {requests.map((r) => (
          <div key={r.id} className="lt-card">
            <strong>{r.title}</strong> <span className="lt-muted">({r.status})</span>
            {r.description && <p>{r.description}</p>}
            {r.status === 'open' && (
              <ConfirmButton className="lt-btn lt-btn--secondary" confirmLabel="Yes, close it" onConfirm={() => closeRequest(r.id)}>Close request</ConfirmButton>
            )}
            <h4>Applications ({(r.applications || []).length})</h4>
            {(r.applications || []).map((a) => (
              <div key={a.id} style={{ borderTop: '1px solid #eee', padding: '8px 0' }}>
                <strong>{a.tutor_name}</strong> <span className="lt-muted">({a.status})</span>
                {a.proposed_rate && <span> — proposed {a.proposed_rate}</span>}
                {a.message && <p>{a.message}</p>}
                {a.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="lt-btn" onClick={() => acceptApp(r.id, a.id)}>Accept (creates booking)</button>
                    <ConfirmButton className="lt-btn lt-btn--secondary" confirmLabel="Yes, decline" onConfirm={() => declineApp(r.id, a.id)}>Decline</ConfirmButton>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Layout>
  );
}
