import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { admin } from '../../api/client';

export default function SuperAdminAuditLog() {
  const [data, setData] = useState({ entries: [], page: 1, total: 0, page_size: 50 });
  const [error, setError] = useState(null);

  const load = (page = 1) => admin.auditLog(page).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(1); }, []);

  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size));

  return (
    <Layout>
      <h1>Audit log</h1>
      <p>Every sensitive admin action — suspensions, settings changes, payouts, and "view as" sessions.</p>
      {error && <div className="lt-error-banner">{error}</div>}
      <div className="lt-card">
        <table className="lt-table">
          <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleString()}</td>
                <td>{e.admin_name}</td>
                <td><code>{e.action}</code></td>
                <td>{e.target_type ? `${e.target_type}: ${e.target_id || ''}` : '—'}</td>
                <td style={{ fontSize: '0.8rem' }}>{e.details ? JSON.stringify(e.details) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.entries.length === 0 && <div className="lt-empty">No admin actions recorded yet.</div>}
      </div>
      {totalPages > 1 && (
        <div className="lt-row" style={{ marginTop: 16, justifyContent: 'center' }}>
          <button className="lt-btn lt-btn--ghost" disabled={data.page <= 1} onClick={() => load(data.page - 1)}>Previous</button>
          <span>Page {data.page} of {totalPages}</span>
          <button className="lt-btn lt-btn--ghost" disabled={data.page >= totalPages} onClick={() => load(data.page + 1)}>Next</button>
        </div>
      )}
    </Layout>
  );
}
