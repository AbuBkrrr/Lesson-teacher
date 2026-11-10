import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { lessonRequests } from '../../api/client';

export default function BrowseRequests() {
  const [open, setOpen] = useState([]);
  const [mine, setMine] = useState([]);
  const [city, setCity] = useState('');
  const [error, setError] = useState(null);
  const [draftById, setDraftById] = useState({});

  async function load() {
    const [openRes, mineRes] = await Promise.all([lessonRequests.open({ city }), lessonRequests.myApplications()]);
    setOpen(openRes.lesson_requests);
    setMine(mineRes.applications);
  }
  useEffect(() => { load(); }, [city]);

  const appliedIds = new Set(mine.map((a) => a.request_id));

  async function apply(requestId) {
    setError(null);
    const draft = draftById[requestId] || {};
    try {
      await lessonRequests.apply(requestId, { message: draft.message, proposed_rate: draft.rate ? Number(draft.rate) : undefined });
      await load();
    } catch (err) {
      setError(err.message || 'Could not apply');
    }
  }

  return (
    <Layout>
      <div className="lt-page">
        <h1>Browse lesson requests</h1>
        <p className="lt-muted">Parents and adult students post what they need. Apply with a message and your rate.</p>
        {error && <div className="lt-error-banner">{error}</div>}

        <div className="lt-field" style={{ maxWidth: 280 }}>
          <label htmlFor="city">Filter by city</label>
          <input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>

        {open.length === 0 && <p className="lt-muted">No open requests right now.</p>}

        {open.map((r) => {
          const applied = appliedIds.has(r.id);
          return (
            <div key={r.id} className="lt-card">
              <strong>{r.title}</strong> <span className="lt-muted">by {r.requester_name}{r.city ? ` · ${r.city}` : ''}</span>
              {r.description && <p>{r.description}</p>}
              {(r.min_budget || r.max_budget) && <p className="lt-muted">Budget: {r.min_budget || '?'} – {r.max_budget || '?'} {r.currency}</p>}
              {applied ? (
                <span className="lt-status-ok">Already applied</span>
              ) : (
                <>
                  <div className="lt-field">
                    <label htmlFor={`browserequests-msg-${r.id}`}>Your message</label>
                    <textarea id={`browserequests-msg-${r.id}`}
                      rows={2}
                      value={draftById[r.id]?.message || ''}
                      onChange={(e) => setDraftById((m) => ({ ...m, [r.id]: { ...m[r.id], message: e.target.value } }))}
                    />
                  </div>
                  <div className="lt-field" style={{ maxWidth: 200 }}>
                    <label htmlFor={`browserequests-rate-${r.id}`}>Proposed rate</label>
                    <input id={`browserequests-rate-${r.id}`}
                      type="number"
                      value={draftById[r.id]?.rate || ''}
                      onChange={(e) => setDraftById((m) => ({ ...m, [r.id]: { ...m[r.id], rate: e.target.value } }))}
                    />
                  </div>
                  <button className="lt-btn" onClick={() => apply(r.id)}>Apply</button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
