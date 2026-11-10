import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import { referrals } from '../api/client';

export default function MyReferrals() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    referrals.mine().then(setData).catch((e) => setError(e.message));
  }, []);

  function copyCode() {
    navigator.clipboard?.writeText(data.referral_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Layout>
      <h1>My referrals</h1>
      <p>Share your code or your email/phone number — anyone who signs up with it is credited to you.</p>

      {error && <div className="lt-error-banner">{error}</div>}

      {data && (
        <>
          <div className="lt-card lt-row-between">
            <div>
              <div className="lt-stat-label">Your referral code</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.04em' }}>{data.referral_code}</div>
            </div>
            <button className="lt-btn lt-btn--secondary" onClick={copyCode}>{copied ? 'Copied!' : 'Copy code'}</button>
          </div>

          <div className="lt-grid" style={{ marginTop: 16 }}>
            <StatCard label="Total referred" value={data.summary.total} />
            <StatCard label="Converted" value={data.summary.converted} />
            <StatCard label="Pending" value={data.summary.pending} />
          </div>

          <div className="lt-card" style={{ marginTop: 16 }}>
            <table className="lt-table">
              <thead><tr><th>Name</th><th>Role</th><th>Signed up</th><th>Status</th></tr></thead>
              <tbody>
                {data.referrals.map((r) => (
                  <tr key={r.id}>
                    <td>{r.referred_name}</td>
                    <td>{r.referred_role}</td>
                    <td>{new Date(r.referred_signed_up_at).toLocaleDateString()}</td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.referrals.length === 0 && <div className="lt-empty">No referrals yet — share your code to get started.</div>}
          </div>
        </>
      )}
    </Layout>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="lt-card">
      <div className="lt-stat-value">{value}</div>
      <div className="lt-stat-label">{label}</div>
    </div>
  );
}
