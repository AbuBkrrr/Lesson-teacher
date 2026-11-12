import React, { useEffect, useState } from 'react';
import { bookings } from '../api/client';

const EMPTY = { summary: '', strengths: '', next_steps: '', homework: '', score: '', engagement: '' };

/** Tutor writes / edits the lesson report; everyone else on the booking reads it. */
export default function LessonReport({ booking, canEdit, onClose }) {
  const [form, setForm] = useState(EMPTY);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    bookings.report(booking.id)
      .then(({ report: r }) => {
        setReport(r);
        setForm({ ...EMPTY, ...Object.fromEntries(Object.entries(r).filter(([k]) => k in EMPTY).map(([k, v]) => [k, v ?? ''])) });
      })
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, [booking.id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const payload = { ...form, score: form.score === '' ? null : Number(form.score), engagement: form.engagement === '' ? null : Number(form.engagement) };
      const { report: r } = await bookings.saveReport(booking.id, payload);
      setReport(r);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  }

  const title = `Lesson report${booking.subject ? `: ${booking.subject}` : ''}${booking.child_name ? ` · ${booking.child_name}` : ''}`;

  return (
    <div className="lt-card" style={{ borderColor: 'var(--lt-primary)' }} role="region" aria-label={title}>
      <h3>{title}</h3>
      {loading && <p>Loading…</p>}
      {error && <div className="lt-error-banner">{error}</div>}
      {saved && <div className="lt-success-banner" role="status">Report saved. The parent has been notified.</div>}

      {!loading && !canEdit && !report && <p className="lt-muted">The tutor hasn't written a report for this lesson yet.</p>}
      {!loading && !canEdit && report && (
        <dl className="lt-report">
          <dt>What we covered</dt><dd>{report.summary}</dd>
          {report.strengths && <><dt>Strengths</dt><dd>{report.strengths}</dd></>}
          {report.next_steps && <><dt>Next steps</dt><dd>{report.next_steps}</dd></>}
          {report.homework && <><dt>Homework</dt><dd>{report.homework}</dd></>}
          {report.score !== null && <><dt>Score</dt><dd>{report.score}/100</dd></>}
          {report.engagement !== null && <><dt>Engagement</dt><dd>{'★'.repeat(report.engagement)}{'☆'.repeat(5 - report.engagement)}</dd></>}
        </dl>
      )}

      {!loading && canEdit && (
        <form onSubmit={save}>
          <div className="lt-field">
            <label htmlFor="rep-summary">What you covered (required)</label>
            <textarea id="rep-summary" rows={3} required maxLength={4000} value={form.summary} onChange={set('summary')} />
          </div>
          <div className="lt-field">
            <label htmlFor="rep-strengths">Strengths</label>
            <textarea id="rep-strengths" rows={2} maxLength={2000} value={form.strengths} onChange={set('strengths')} />
          </div>
          <div className="lt-field">
            <label htmlFor="rep-next">Next steps</label>
            <textarea id="rep-next" rows={2} maxLength={2000} value={form.next_steps} onChange={set('next_steps')} />
          </div>
          <div className="lt-field">
            <label htmlFor="rep-homework">Homework</label>
            <textarea id="rep-homework" rows={2} maxLength={2000} value={form.homework} onChange={set('homework')} />
          </div>
          <div className="lt-row">
            <div className="lt-field" style={{ flex: 1 }}>
              <label htmlFor="rep-score">Score (0–100)</label>
              <input id="rep-score" type="number" min={0} max={100} value={form.score} onChange={set('score')} />
            </div>
            <div className="lt-field" style={{ flex: 1 }}>
              <label htmlFor="rep-eng">Engagement</label>
              <select id="rep-eng" value={form.engagement} onChange={set('engagement')}>
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
              </select>
            </div>
          </div>
          <span className="lt-helper-text">Scores feed the child's skill progress once the lesson is marked completed.</span>
          <div className="lt-row" style={{ marginTop: 8 }}>
            <button className="lt-btn" type="submit">{report ? 'Update report' : 'Save report'}</button>
          </div>
        </form>
      )}
      <button className="lt-btn lt-btn--ghost" style={{ marginTop: 8 }} onClick={onClose}>Close</button>
    </div>
  );
}
