import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { Link } from 'react-router-dom';
import { admin } from '../../api/client';

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    admin.stats().then(setStats).catch((e) => setError(e.message));
  }, []);

  const usersByRole = Object.fromEntries((stats?.users_by_role || []).map((r) => [r.role, r.count]));
  const referralsByStatus = Object.fromEntries((stats?.referrals_by_status || []).map((r) => [r.status, r.count]));

  return (
    <Layout>
      <h1>Platform overview</h1>
      <p>Everything happening across Lesson Teacher, at a glance.</p>

      {error && <div className="lt-error-banner">{error}</div>}

      {stats && (
        <>
          <div className="lt-card" style={{ marginBottom: 16 }}>
            <h3>Needs your attention</h3>
            {Object.values(stats.attention || {}).every((n) => !n) ? (
              <p>Nothing is waiting on you.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                {[
                  ['id_verifications', 'ID verifications to review', '/superadmin/verifications'],
                  ['transfers_to_confirm', 'Bank transfers to confirm', '/superadmin/payments'],
                  ['refund_requests', 'Refund requests open', '/superadmin/refunds'],
                  ['tutors_owed', 'Tutors waiting to be paid', '/superadmin/payouts'],
                  ['unresolved_referrals', 'Unresolved referrals', '/superadmin/referrals'],
                ].filter(([k]) => stats.attention?.[k] > 0).map(([k, label, to]) => (
                  <li key={k}><Link to={to}><strong>{stats.attention[k]}</strong> {label}</Link></li>
                ))}
              </ul>
            )}
          </div>

          <div className="lt-grid lt-grid--stats">
            <StatCard label="Parents" value={usersByRole.parent || 0} />
            <StatCard label="Adult students" value={usersByRole.adult_student || 0} />
            <StatCard label="Children" value={usersByRole.child || 0} />
            <StatCard label="Tutors" value={usersByRole.tutor || 0} />
            <StatCard label="School admins" value={usersByRole.school_admin || 0} />
            <StatCard label="Schools" value={stats.total_schools} />
            <StatCard label="Bookings" value={stats.total_bookings} />
          </div>

          {(stats.revenue || []).length > 0 && (
            <div className="lt-card" style={{ marginTop: 16 }}>
              <h3>Revenue (successful payments)</h3>
              <div className="lt-row" style={{ flexWrap: 'wrap', gap: 20 }}>
                {stats.revenue.map((r) => (
                  <React.Fragment key={r.currency}>
                    <MiniStat label={`${r.currency} gross`} value={r.gross.toLocaleString()} />
                    <MiniStat label={`${r.currency} platform fees`} value={r.platform_fees.toLocaleString()} />
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          <div className="lt-card" style={{ marginTop: 16 }}>
            <h3>Referral pipeline</h3>
            <div className="lt-row" style={{ flexWrap: 'wrap', gap: 20 }}>
              <MiniStat label="Pending" value={referralsByStatus.pending || 0} />
              <MiniStat label="Converted" value={referralsByStatus.converted || 0} />
              <MiniStat label="Unresolved" value={referralsByStatus.unresolved || 0} />
              <MiniStat label="Invalid" value={referralsByStatus.invalid || 0} />
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="lt-card">
      <div className="lt-stat-value">{value ?? '—'}</div>
      <div className="lt-stat-label">{label}</div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{value}</div>
      <div className="lt-stat-label">{label}</div>
    </div>
  );
}
