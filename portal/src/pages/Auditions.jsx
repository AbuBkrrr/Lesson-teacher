import React, { useEffect, useState } from 'react';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import { auditions } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { localInputToIso, nowLocalInput } from '../utils/time';

const TYPE_LABEL = { video: 'Video', live: 'Live session', portfolio: 'Portfolio', challenge: 'Challenge' };
const LINK_LABEL = { video: 'Video link', portfolio: 'Portfolio link', challenge: 'Link to your answer', live: 'Meeting link (optional)' };

function Stars({ value }) {
  return <span aria-label={`${value} out of 5`}>{'★'.repeat(value)}{'☆'.repeat(5 - value)}</span>;
}

export default function Auditions() {
  const { user } = useAuth();
  const isTutor = user?.role === 'tutor';
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [forms, setForms] = useState({}); // auditionId -> { url, when, note, rating, decision, feedback }

  const load = () => auditions.mine().then((d) => setRows(d.auditions)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  useRefreshOnFocus(load);

  const setField = (id, k, v) => setForms((f) => ({ ...f, [id]: { ...f[id], [k]: v } }));

  async function run(id, fn, okMsg) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (okMsg) setNotice(okMsg);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  function submit(a) {
    const f = forms[a.id] || {};
    const extra = { tutor_note: f.note || undefined };
    if (a.type === 'live') extra.scheduled_at = f.when ? localInputToIso(f.when) : undefined;
    return run(a.id, () => auditions.updateStatus(a.id, 'ready', f.url || undefined, extra), 'Sent to the parent.');
  }

  function review(a, decision) {
    const f = forms[a.id] || {};
    return run(a.id, () => auditions.review(a.id, {
      rating: Number(f.rating || 0), decision, feedback: f.feedback || undefined,
    }), decision === 'accepted' ? 'Accepted — you can now book lessons with this tutor.' : 'Thanks, your feedback was sent.');
  }

  return (
    <Layout>
      <h1>Auditions</h1>
      <p>{isTutor
        ? 'Parents ask for an audition before booking. Send a video, portfolio, challenge answer, or a time for a short live session.'
        : 'Ask a tutor to show how they teach before you book. Rate each audition and accept or decline the tutor.'}</p>

      {error && <div className="lt-error-banner">{error}</div>}
      {notice && <div className="lt-success-banner" role="status">{notice}</div>}

      {rows.length === 0 && <div className="lt-card lt-empty">No auditions yet.{!isTutor && <> <Link to="/parent/browse">Find a tutor</Link> to request one.</>}</div>}

      <div className="lt-audition-list">
        {rows.map((a) => {
          const f = forms[a.id] || {};
          return (
            <article key={a.id} className="lt-card lt-audition-card">
              <header className="lt-row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ margin: 0 }}>{isTutor ? a.parent_name : a.tutor_name}</h3>
                  <p className="lt-muted" style={{ margin: '2px 0 0' }}>
                    {TYPE_LABEL[a.type] || 'Video'} audition
                    {a.skill_name ? ` · ${a.skill_name}` : ''}
                    {a.child_name ? ` · for ${a.child_name}` : ''}
                    {' · '}requested {new Date(a.created_at).toLocaleDateString()}
                  </p>
                </div>
                <StatusBadge status={a.status} />
              </header>

              {a.brief && <p><strong>{a.type === 'challenge' ? 'Challenge:' : 'Request:'}</strong> {a.brief}</p>}
              {a.tutor_note && <p><strong>Tutor's note:</strong> {a.tutor_note}</p>}
              {a.scheduled_at && <p><strong>Live session:</strong> {new Date(a.scheduled_at).toLocaleString()}</p>}
              {a.video_url && <p><a href={a.video_url} target="_blank" rel="noreferrer noopener">{a.type === 'portfolio' ? 'Open portfolio' : a.type === 'challenge' ? 'Open answer' : a.type === 'live' ? 'Join meeting' : 'Watch video'}</a></p>}

              {a.decision && (
                <p className={`lt-badge ${a.decision === 'accepted' ? 'lt-badge--success' : 'lt-badge--muted'}`} style={{ display: 'inline-block' }}>
                  {a.decision === 'accepted' ? 'Accepted' : 'Not accepted'} · <Stars value={a.rating} />
                </p>
              )}
              {a.feedback && <p><strong>Parent feedback:</strong> {a.feedback}</p>}

              {isTutor && a.status === 'pending' && (
                <div className="lt-audition-form">
                  {a.type === 'live' && (
                    <div className="lt-field">
                      <label htmlFor={`aud-when-${a.id}`}>Session time</label>
                      <input id={`aud-when-${a.id}`} type="datetime-local" min={nowLocalInput()} value={f.when || ''} onChange={(e) => setField(a.id, 'when', e.target.value)} />
                    </div>
                  )}
                  <div className="lt-field">
                    <label htmlFor={`aud-url-${a.id}`}>{LINK_LABEL[a.type] || 'Video link'}</label>
                    <input id={`aud-url-${a.id}`} type="url" placeholder="https://…" value={f.url || ''} onChange={(e) => setField(a.id, 'url', e.target.value)} />
                  </div>
                  <div className="lt-field">
                    <label htmlFor={`aud-note-${a.id}`}>Note for the parent (optional)</label>
                    <textarea id={`aud-note-${a.id}`} rows={2} maxLength={2000} value={f.note || ''} onChange={(e) => setField(a.id, 'note', e.target.value)} />
                  </div>
                  <div className="lt-row">
                    <button className="lt-btn lt-btn--sm" disabled={busyId === a.id} onClick={() => submit(a)}>Send to parent</button>
                    <button className="lt-btn lt-btn--sm lt-btn--danger" disabled={busyId === a.id} onClick={() => run(a.id, () => auditions.updateStatus(a.id, 'declined'))}>Decline</button>
                  </div>
                </div>
              )}

              {!isTutor && ['ready', 'completed'].includes(a.status) && (
                <div className="lt-audition-form">
                  <h4 style={{ margin: '8px 0' }}>{a.decision ? 'Change your review' : 'Review this audition'}</h4>
                  <fieldset className="lt-stars-input">
                    <legend>Rating</legend>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <label key={n}>
                        <input type="radio" name={`rating-${a.id}`} value={n} checked={Number(f.rating) === n} onChange={() => setField(a.id, 'rating', n)} />
                        <span aria-hidden="true">{Number(f.rating || 0) >= n ? '★' : '☆'}</span>
                        <span className="lt-sr-only">{n} star{n > 1 ? 's' : ''}</span>
                      </label>
                    ))}
                  </fieldset>
                  <div className="lt-field">
                    <label htmlFor={`aud-fb-${a.id}`}>Feedback for the tutor (optional)</label>
                    <textarea id={`aud-fb-${a.id}`} rows={2} maxLength={2000} value={f.feedback || ''} onChange={(e) => setField(a.id, 'feedback', e.target.value)} />
                  </div>
                  <div className="lt-row">
                    <button className="lt-btn lt-btn--sm" disabled={busyId === a.id || !f.rating} onClick={() => review(a, 'accepted')}>Accept tutor</button>
                    <button className="lt-btn lt-btn--sm lt-btn--secondary" disabled={busyId === a.id || !f.rating} onClick={() => review(a, 'rejected')}>Decline tutor</button>
                    {a.decision === 'accepted' && <Link className="lt-btn lt-btn--sm lt-btn--ghost" to="/parent/browse">Book lessons</Link>}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </Layout>
  );
}
