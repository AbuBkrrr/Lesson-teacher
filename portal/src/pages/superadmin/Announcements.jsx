import React, { useState } from 'react';
import Layout from '../../components/Layout';
import ConfirmButton from '../../components/ConfirmButton';
import { admin } from '../../api/client';

const AUDIENCES = [['all', 'Everyone'], ['parent', 'Parents'], ['adult_student', 'Adult students'], ['tutor', 'Tutors'], ['child', 'Children'], ['school_admin', 'School admins']];

export default function SuperAdminAnnouncements() {
  const [audience, setAudience] = useState('all');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const ready = subject.trim() && body.trim();

  async function send() {
    setBusy(true); setError(null); setDone(null);
    try {
      const r = await admin.announce({ audience, subject, body });
      setDone(`Sent to ${r.recipients} ${r.recipients === 1 ? 'person' : 'people'}.`);
      setSubject(''); setBody('');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Layout>
      <h1>Announcements</h1>
      <p>Send a message to a group. It appears in their Notifications and goes out by email, SMS and push where available. This cannot be recalled.</p>
      {error && <div className="lt-error-banner" role="alert">{error}</div>}
      {done && <div className="lt-card" role="status">{done}</div>}
      <form className="lt-card" onSubmit={(e) => e.preventDefault()} style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
        <label htmlFor="ann-audience">Send to</label>
        <select id="ann-audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
          {AUDIENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label htmlFor="ann-subject">Subject</label>
        <input id="ann-subject" maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)} />
        <label htmlFor="ann-body">Message</label>
        <textarea id="ann-body" rows={5} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
        <div>
          {ready && !busy
            ? <ConfirmButton className="lt-btn" confirmLabel={`Yes, send to ${AUDIENCES.find((a) => a[0] === audience)[1].toLowerCase()}`} onConfirm={send}>Send announcement</ConfirmButton>
            : <button type="button" className="lt-btn" disabled>{busy ? 'Sending…' : 'Send announcement'}</button>}
        </div>
      </form>
    </Layout>
  );
}
