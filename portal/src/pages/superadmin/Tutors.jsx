import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';
import { ListFooter, selectStyle } from '../../components/AdminTable';
import usePagedList from '../../hooks/usePagedList';
import { admin, reviews } from '../../api/client';

export default function SuperAdminTutors() {
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [pv, setPv] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(query.trim()), 300); return () => clearTimeout(t); }, [query]);
  const list = usePagedList((page) => admin.tutors({ page, page_size: 25, ...(q ? { q } : {}), ...(pv ? { platform_verified: pv } : {}) }), 'tutors', [q, pv]);
  const [busyId, setBusyId] = useState(null);

  async function toggle(t) {
    setBusyId(t.user_id);
    try { await reviews.setVerified(t.user_id, !t.platform_verified); list.patchRow(t.user_id, { platform_verified: t.platform_verified ? 0 : 1 }, 'user_id'); } catch (e) { list.setError(e.message); } finally { setBusyId(null); }
  }

  return (
    <Layout>
      <div className="lt-row-between">
        <div><h1>Tutors</h1><p>Give the Platform-verified badge to tutors whose profile and ID you have reviewed.</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input type="search" aria-label="Search tutors" placeholder="Name or email" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...selectStyle, minWidth: 220 }} />
          <select aria-label="Filter by badge" value={pv} onChange={(e) => setPv(e.target.value)} style={selectStyle}>
            <option value="">All tutors</option><option value="true">Platform-verified</option><option value="false">Not verified</option>
          </select>
        </div>
      </div>
      {list.error && <div className="lt-error-banner" role="alert">{list.error}</div>}
      <div className="lt-card">
        <table className="lt-table">
          <thead><tr><th>Tutor</th><th>Email</th><th>ID check</th><th>Rating</th><th>Account</th><th>Badge</th></tr></thead>
          <tbody>
            {(list.rows || []).map((t) => (
              <tr key={t.user_id}>
                <td>{t.full_name}</td>
                <td>{t.email || '—'}</td>
                <td><StatusBadge status={t.id_verification_status || 'pending'} /></td>
                <td>{t.review_count ? `${Number(t.rating).toFixed(1)} (${t.review_count})` : '—'}</td>
                <td><StatusBadge status={t.status} /></td>
                <td>
                  <button type="button" className={`lt-btn lt-btn--sm ${t.platform_verified ? 'lt-btn--secondary' : ''}`} disabled={busyId === t.user_id} aria-pressed={!!t.platform_verified} onClick={() => toggle(t)}>
                    {t.platform_verified ? 'Remove badge' : 'Give badge'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ListFooter list={list} empty="No tutors match this filter." />
      </div>
    </Layout>
  );
}
