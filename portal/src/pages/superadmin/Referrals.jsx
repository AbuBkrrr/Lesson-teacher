import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { admin, referrals } from '../../api/client';

export default function SuperAdminReferrals() {
  const [unresolved, setUnresolved] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [selection, setSelection] = useState({});

  const load = () => {
    Promise.all([referrals.unresolved(), admin.listUsers()])
      .then(([r, u]) => {
        setUnresolved(r.referrals);
        setUsers(u.users);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(load, []);

  async function resolve(referralId) {
    const marketerId = selection[referralId];
    if (!marketerId) return;
    setError(null);
    setSuccess(null);
    try {
      await referrals.resolve(referralId, marketerId);
      setSuccess('Referral resolved.');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Layout>
      <h1>Unresolved referrals</h1>
      <p>
        These signups entered a referral email or phone number that didn't match any existing account —
        usually because the referrer hasn't signed up yet, or typed it slightly differently. Match them here
        once you've identified who it should be.
      </p>

      {error && <div className="lt-error-banner">{error}</div>}
      {success && <div className="lt-success-banner">{success}</div>}

      <div className="lt-card">
        <table className="lt-table">
          <thead>
            <tr>
              <th>New signup</th><th>Referral email/phone entered</th><th>Match to</th><th></th>
            </tr>
          </thead>
          <tbody>
            {unresolved.map((r) => (
              <tr key={r.id}>
                <td>{r.referred_name}</td>
                <td><code>{r.marketer_identifier}</code></td>
                <td>
                  <select
                    value={selection[r.id] || ''}
                    onChange={(e) => setSelection((s) => ({ ...s, [r.id]: e.target.value }))}
                    style={{ padding: 6, borderRadius: 8, border: '1px solid var(--lt-border)', minWidth: 220 }}
                  >
                    <option value="">Select a user…</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name} — {u.email || u.phone}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button className="lt-btn lt-btn--sm" disabled={!selection[r.id]} onClick={() => resolve(r.id)}>
                    Resolve
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {unresolved.length === 0 && <div className="lt-empty">No unresolved referrals right now.</div>}
      </div>
    </Layout>
  );
}
