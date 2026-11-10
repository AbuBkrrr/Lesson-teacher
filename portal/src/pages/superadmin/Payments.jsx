import React, { useState } from 'react';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';
import ConfirmButton from '../../components/ConfirmButton';
import { ListFooter, selectStyle, money } from '../../components/AdminTable';
import usePagedList from '../../hooks/usePagedList';
import { admin, payments, assetUrl } from '../../api/client';

export default function SuperAdminPayments() {
  const [status, setStatus] = useState('awaiting_confirmation');
  const [method, setMethod] = useState('');
  const list = usePagedList((page) => admin.payments({ page, page_size: 25, ...(status ? { status } : {}), ...(method ? { method } : {}) }), 'payments', [status, method]);
  const [busyId, setBusyId] = useState(null);

  async function confirm(p) {
    setBusyId(p.id);
    try { await payments.confirm(p.id); list.patchRow(p.id, { status: 'successful' }); } catch (e) { list.setError(e.message); } finally { setBusyId(null); }
  }

  return (
    <Layout>
      <div className="lt-row-between">
        <div><h1>Payments</h1><p>Bank transfers waiting for confirmation are listed first. Check the proof, then confirm receipt.</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
            {['', 'awaiting_confirmation', 'pending', 'successful', 'failed', 'refunded'].map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
          <select aria-label="Filter by method" value={method} onChange={(e) => setMethod(e.target.value)} style={selectStyle}>
            {['', 'direct_transfer', 'card', 'ussd', 'bank_transfer'].map((m) => <option key={m} value={m}>{m ? m.replace(/_/g, ' ') : 'All methods'}</option>)}
          </select>
        </div>
      </div>
      {list.error && <div className="lt-error-banner" role="alert">{list.error}</div>}
      <div className="lt-card">
        <table className="lt-table">
          <thead><tr><th>Payer</th><th>Tutor</th><th>Subject</th><th>Amount</th><th>Method</th><th>Status</th><th>Proof</th><th></th></tr></thead>
          <tbody>
            {(list.rows || []).map((p) => (
              <tr key={p.id}>
                <td>{p.parent_name}</td>
                <td>{p.tutor_name}</td>
                <td>{p.subject || '—'}</td>
                <td>{money(p.amount, p.currency)}</td>
                <td>{(p.method || '').replace(/_/g, ' ')}</td>
                <td><StatusBadge status={p.status} /></td>
                <td>{p.proof_url ? <a href={assetUrl(p.proof_url)} target="_blank" rel="noreferrer">View proof</a> : '—'}</td>
                <td>
                  {p.status === 'awaiting_confirmation' && (
                    <ConfirmButton className="lt-btn lt-btn--sm" disabled={busyId === p.id} confirmLabel={`Yes, ${money(p.amount, p.currency)} received`} label={`Confirm payment from ${p.parent_name}`} onConfirm={() => confirm(p)}>Confirm received</ConfirmButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ListFooter list={list} empty={status === 'awaiting_confirmation' ? 'No transfers waiting for confirmation.' : 'No payments match this filter.'} />
      </div>
    </Layout>
  );
}
