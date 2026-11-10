import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';
import ConfirmButton from '../../components/ConfirmButton';
import { admin, startImpersonation } from '../../api/client';

const PAGE_SIZE = 50;
const ROLES = ['', 'parent', 'adult_student', 'child', 'tutor', 'school_admin', 'super_admin'];

export default function SuperAdminUsers() {
  const [users, setUsers] = useState([]);
  const [roleFilter, setRoleFilter] = useState('');
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebouncedQ(query.trim()), 300); return () => clearTimeout(t); }, [query]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);

  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  // Fetches one page; page 1 replaces the list, later pages append.
  const fetchPage = (n) => {
    const params = { page: n, page_size: PAGE_SIZE, ...(roleFilter ? { role: roleFilter } : {}), ...(debouncedQ ? { q: debouncedQ } : {}) };
    return admin.listUsers(params).then((d) => {
      setUsers((prev) => (n === 1 ? d.users : [...prev, ...d.users]));
      setTotal(d.total);
      setPage(n);
    }).catch((e) => setError(e.message));
  };

  useEffect(() => { fetchPage(1); }, [roleFilter, debouncedQ]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    setLoadingMore(true);
    await fetchPage(page + 1);
    setLoadingMore(false);
  }

  async function toggleStatus(user) {
    setBusyId(user.id);
    try {
      if (user.status === 'suspended') await admin.reactivateUser(user.id);
      else await admin.suspendUser(user.id);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: user.status === 'suspended' ? 'active' : 'suspended' } : u)));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function sendLink(user, kind) {
    setBusyId(user.id);
    setNotice(null);
    try {
      if (kind === 'reset') await admin.sendPasswordReset(user.id);
      else await admin.resendVerification(user.id);
      setNotice(kind === 'reset' ? `Password reset link sent to ${user.full_name}.` : `Verification email sent to ${user.full_name}.`);
    } catch (e) { setError(e.message); } finally { setBusyId(null); }
  }

  async function viewAs(user) {
    setBusyId(user.id);
    try {
      startImpersonation(await admin.impersonate(user.id));
      // Full reload so every context re-reads the swapped session.
      window.location.hash = '#/';
      window.location.reload();
    } catch (e) {
      setError(e.message);
      setBusyId(null);
    }
  }

  return (
    <Layout>
      <div className="lt-row-between">
        <div>
          <h1>Users</h1>
          <p>Every account on the platform.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input type="search" aria-label="Search users" placeholder="Search name, email, phone, code" value={query} onChange={(e) => setQuery(e.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid var(--lt-border)', minWidth: 240 }} />
        <select aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid var(--lt-border)' }}>
          {ROLES.map((r) => <option key={r} value={r}>{r || 'All roles'}</option>)}
        </select>
        </div>
      </div>

      {error && <div className="lt-error-banner" role="alert">{error}</div>}
      {notice && <div className="lt-card" role="status">{notice}</div>}

      <div className="lt-card">
        <table className="lt-table">
          <thead>
            <tr>
              <th>Name</th><th>Role</th><th>Email</th><th>Phone</th><th>Referral code</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.full_name}</td>
                <td>{u.role}</td>
                <td>{u.email || '—'}</td>
                <td>{u.phone || '—'}</td>
                <td><code>{u.referral_code}</code></td>
                <td><StatusBadge status={u.status} /></td>
                <td>
                  {u.role !== 'super_admin' && u.status !== 'suspended' && (
                    <button className="lt-btn lt-btn--sm lt-btn--ghost" style={{ marginRight: 6 }} disabled={busyId === u.id} onClick={() => viewAs(u)}>
                      View as
                    </button>
                  )}
                  {u.role !== 'super_admin' && u.email && (
                    <button type="button" className="lt-btn lt-btn--sm lt-btn--ghost" style={{ marginRight: 6 }} disabled={busyId === u.id} aria-label={`Send ${u.full_name} a password reset link`} onClick={() => sendLink(u, 'reset')}>
                      Reset link
                    </button>
                  )}
                  {u.role !== 'super_admin' && (
                    u.status === 'suspended'
                      ? <button type="button" className="lt-btn lt-btn--sm" disabled={busyId === u.id} onClick={() => toggleStatus(u)}>Reactivate</button>
                      : <ConfirmButton disabled={busyId === u.id} confirmLabel="Yes, suspend" label={`Suspend ${u.full_name}`} onConfirm={() => toggleStatus(u)}>Suspend</ConfirmButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && <div className="lt-empty">No users match this filter.</div>}
        {users.length > 0 && (
          <div className="lt-row-between" style={{ marginTop: 12 }}>
            <span style={{ color: 'var(--lt-muted)' }}>Showing {users.length} of {total}</span>
            {users.length < total && (
              <button className="lt-btn" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
