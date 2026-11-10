import React, { useState } from 'react';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';
import { ListFooter, selectStyle, money } from '../../components/AdminTable';
import usePagedList from '../../hooks/usePagedList';
import { admin, refundRequests } from '../../api/client';

export default function SuperAdminRefunds() {
  const [status, setStatus] = useState('pending');
  const list = usePagedList((page) => admin.refunds({ page, page_size: 25, ...(status ? { status } : {}) }), 'refunds', [status]);
  const [notes, setNotes] = useState({});
  const [busyId, setBusyId] = useState(null);

  async function resolve(r, next) {
    setBusyId(r.id);
    try {
      await refundRequests.resolve(r.id, { status: next, resolution_note: (notes[r.id] || '').trim() || undefined });
      list.reload();
    } catch (e) { list.setError(e.message); } finally { setBusyId(null); }
  }

  return (
    <Layout>
      <div className="lt-row-between">
        <div><h1>Refund requests</h1><p>Approve or deny, then mark Completed once the money has been returned through your payment provider.</p></div>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
          {['', 'pending', 'approved', 'completed', 'denied'].map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
        </select>
      </div>
      {list.error && <div className="lt-error-banner" role="alert">{list.error}</div>}
      {(list.rows || []).map((r) => (
        <div className="lt-card" key={r.id} style={{ marginBottom: 12 }}>
          <div className="lt-row-between">
            <strong>{r.requester_name} — {r.subject || 'Lesson'} with {r.tutor_name}</strong>
            <span><StatusBadge status={r.status} /> {r.resolution === 'reschedule' ? 'wants to reschedule' : `wants ${money(r.amount, r.currency)} back`}</span>
          </div>
          <p style={{ margin: '8px 0' }}>“{r.reason}”</p>
          {r.payout_id && r.resolution === 'refund' && <p style={{ color: 'var(--lt-danger-fg, #b00)' }}>This payment has already been paid out to the tutor.</p>}
          {r.resolution_note && <p>Note: {r.resolution_note}</p>}
          {(r.status === 'pending' || r.status === 'approved') && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input aria-label={`Note for ${r.requester_name}'s request`} placeholder="Note to the requester (optional)" value={notes[r.id] || ''} onChange={(e) => setNotes((m) => ({ ...m, [r.id]: e.target.value }))} style={{ ...selectStyle, flex: 1, minWidth: 200 }} />
              {r.status === 'pending' && <button type="button" className="lt-btn lt-btn--sm" disabled={busyId === r.id} onClick={() => resolve(r, 'approved')}>Approve</button>}
              <button type="button" className="lt-btn lt-btn--sm" disabled={busyId === r.id} onClick={() => resolve(r, 'completed')}>Mark completed</button>
              <button type="button" className="lt-btn lt-btn--sm lt-btn--secondary" disabled={busyId === r.id} onClick={() => resolve(r, 'denied')}>Deny</button>
            </div>
          )}
        </div>
      ))}
      <ListFooter list={list} empty={status === 'pending' ? 'No pending refund requests.' : 'No refund requests match this filter.'} />
    </Layout>
  );
}
