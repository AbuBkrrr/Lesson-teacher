import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';
import { tutors, payments, payouts, instantPayout } from '../../api/client';

export default function TutorEarnings() {
  const [profile, setProfile] = useState(null);
  const [summary, setSummary] = useState(null);
  const [payoutHistory, setPayoutHistory] = useState([]);
  const [bankForm, setBankForm] = useState({ bank_name: '', bank_code: '', account_number: '', account_name: '' });
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    tutors.myProfile().then((d) => {
      setProfile(d.profile);
      setBankForm({
        bank_name: d.profile.bank_name || '', bank_code: d.profile.bank_code || '',
        account_number: d.profile.account_number || '', account_name: d.profile.account_name || '',
      });
    }).catch((e) => setError(e.message));
    payments.earningsSummary().then(setSummary).catch(() => {});
    payouts.mine().then((d) => setPayoutHistory(d.payouts)).catch(() => {});
  };
  useEffect(load, []);

  const update = (field) => (e) => setBankForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSaveBank(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await tutors.updateBankAccount(bankForm);
      setSuccess('Bank account saved. You can now receive payouts.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const currency = profile?.currency || 'NGN';

  async function handleInstantPayout() {
    setError(null); setSuccess(null);
    try {
      const res = await instantPayout.request();
      setSuccess(`Instant payout sent: ${res.payout.currency} ${res.payout.amount.toLocaleString()} (fee: ${res.fee.toLocaleString()})`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Layout>
      <h1>Earnings</h1>
      <p>What you've earned from confirmed, paid sessions, and your payout history.</p>

      {error && <div className="lt-error-banner">{error}</div>}
      {success && <div className="lt-success-banner">{success}</div>}

      {summary && (
        <div className="lt-grid lt-grid--stats">
          <StatCard label="Total earned" value={`${currency} ${summary.total_earned.toLocaleString()}`} />
          <StatCard label="Already paid out" value={`${currency} ${summary.already_paid_out.toLocaleString()}`} />
          <StatCard label="Pending payout" value={`${currency} ${summary.pending_payout.toLocaleString()}`} />
        </div>
      )}

      {summary?.pending_payout > 0 && (
        <button className="lt-btn lt-btn--secondary" style={{ marginTop: 12 }} onClick={handleInstantPayout}>
          ⚡ Cash out now (instant payout, small fee applies)
        </button>
      )}

      <div className="lt-card" style={{ marginTop: 16, maxWidth: 480 }}>
        <h3>Payout bank account</h3>
        <p style={{ fontSize: '0.85rem' }}>Where your earnings are sent when the platform pays out.</p>
        <form onSubmit={handleSaveBank}>
          <div className="lt-field">
            <label htmlFor="earnings-f1">Bank name</label>
            <input id="earnings-f1" value={bankForm.bank_name} onChange={update('bank_name')} placeholder="e.g. GTBank" />
          </div>
          <div className="lt-field">
            <label htmlFor="earnings-f2">Bank code</label>
            <input id="earnings-f2" value={bankForm.bank_code} onChange={update('bank_code')} placeholder="e.g. 058" required />
          </div>
          <div className="lt-field">
            <label htmlFor="earnings-f3">Account number</label>
            <input id="earnings-f3" value={bankForm.account_number} onChange={update('account_number')} required />
          </div>
          <div className="lt-field">
            <label htmlFor="earnings-f4">Account name</label>
            <input id="earnings-f4" value={bankForm.account_name} onChange={update('account_name')} required />
          </div>
          <button className="lt-btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save bank account'}</button>
        </form>
      </div>

      <div className="lt-card" style={{ marginTop: 16 }}>
        <h3>Payout history</h3>
        <table className="lt-table">
          <thead><tr><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {payoutHistory.map((p) => (
              <tr key={p.id}>
                <td>{new Date(p.created_at).toLocaleDateString()}</td>
                <td>{p.currency} {p.amount.toLocaleString()}</td>
                <td><StatusBadge status={p.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {payoutHistory.length === 0 && <div className="lt-empty">No payouts yet.</div>}
      </div>
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
