import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';
import ConfirmButton from '../../components/ConfirmButton';
import { ListFooter, selectStyle, money } from '../../components/AdminTable';
import usePagedList from '../../hooks/usePagedList';
import { admin, bookings } from '../../api/client';
import { formatLesson } from '../../utils/time';

export default function SuperAdminBookings() {
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(query.trim()), 300); return () => clearTimeout(t); }, [query]);
  const list = usePagedList((page) => admin.bookings({ page, page_size: 25, ...(status ? { status } : {}), ...(q ? { q } : {}) }), 'bookings', [status, q]);
  const [busyId, setBusyId] = useState(null);

  async function setBookingStatus(b, next) {
    setBusyId(b.id);
    try { await bookings.updateStatus(b.id, next); list.patchRow(b.id, { status: next }); } catch (e) { list.setError(e.message); } finally { setBusyId(null); }
  }

  return (
    <Layout>
      <div className="lt-row-between">
        <div><h1>Bookings</h1><p>Every lesson on the platform. Step in only when something is stuck.</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input type="search" aria-label="Search bookings" placeholder="Parent, tutor or subject" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...selectStyle, minWidth: 220 }} />
          <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
            {['', 'pending', 'confirmed', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
        </div>
      </div>
      {list.error && <div className="lt-error-banner" role="alert">{list.error}</div>}
      <div className="lt-card">
        <table className="lt-table">
          <thead><tr><th>Booker</th><th>Tutor</th><th>Subject</th><th>Scheduled</th><th>Status</th><th>Payment</th><th></th></tr></thead>
          <tbody>
            {(list.rows || []).map((b) => (
              <tr key={b.id}>
                <td>{b.parent_name}</td>
                <td>{b.tutor_name}</td>
                <td>{b.subject || '—'}</td>
                <td>{formatLesson(b.scheduled_at) || 'No time set'}</td>
                <td><StatusBadge status={b.status} /></td>
                <td>{b.payment_status ? <><StatusBadge status={b.payment_status} /> {money(b.payment_amount, b.currency)}</> : '—'}</td>
                <td>
                  {(b.status === 'pending' || b.status === 'confirmed') && (
                    <ConfirmButton disabled={busyId === b.id} confirmLabel="Yes, cancel" label={`Cancel booking for ${b.parent_name}`} onConfirm={() => setBookingStatus(b, 'cancelled')}>Cancel</ConfirmButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ListFooter list={list} empty="No bookings match this filter." />
      </div>
    </Layout>
  );
}
