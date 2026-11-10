import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import ConfirmButton from '../../components/ConfirmButton';
import StatusBadge from '../../components/StatusBadge';
import { payouts } from '../../api/client';

export default function SuperAdminPayouts() {
  const [balances, setBalances] = useState([]);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    payouts.balances().then((d) => setBalances(d.balances)).catch((e) => setError(e.message));
    payouts.listAll().then((d) => setHistory(d.payouts)).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  async function trigger(tutorId) {
    setBusyId(tutorId);
    setError(null);
    setSuccess(null);
    try {
      await payouts.payoutTutor(tutorId);
      setSuccess('Payout sent.');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Layout>
      <h1>Payouts</h1>
      <p>What's owed to each tutor from paid sessions, and the full payout history.</p>

      {error && <div className="lt-error-banner">{error}</div>}
      {success && <div className="lt-success-banner">{success}</div>}

      <div className="lt-card">
        <h3>Owed balances</h3>
        <table className="lt-table">
          <thead><tr><th>Tutor</th><th>Owed</th><th></th></tr></thead>
          <tbody>
            {balances.map((b) => (
              <tr key={b.tutor_id}>
                <td>{b.full_name}</td>
                <td>{b.currency} {b.owed.toLocaleString()}</td>
                <td>
                  <ConfirmButton className="lt-btn lt-btn--sm" disabled={busyId === b.tutor_id} label={`Pay out ${b.full_name}`} confirmLabel={`Yes, pay ${b.currency} ${b.owed.toLocaleString()}`} onConfirm={() => trigger(b.tutor_id)}>
                    Pay out
                  </ConfirmButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {balances.length === 0 && <div className="lt-empty">Nothing owed right now.</div>}
      </div>

      <div className="lt-card" style={{ marginTop: 16 }}>
        <h3>Payout history</h3>
        <table className="lt-table">
          <thead><tr><th>Date</th><th>Tutor</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {history.map((p) => (
              <tr key={p.id}>
                <td>{new Date(p.created_at).toLocaleDateString()}</td>
                <td>{p.tutor_name}</td>
                <td>{p.currency} {p.amount.toLocaleString()}</td>
                <td><StatusBadge status={p.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {history.length === 0 && <div className="lt-empty">No payouts yet.</div>}
      </div>
    </Layout>
  );
}
