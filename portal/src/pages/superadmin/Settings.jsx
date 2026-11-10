import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { settings } from '../../api/client';

export default function SuperAdminSettings() {
  const [commission, setCommission] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [sibling, setSibling] = useState('');
  const [guarantee, setGuarantee] = useState('');
  const [instantFee, setInstantFee] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [saving, setSaving] = useState(false);

  function applySettings(d) {
    setCommission(String(d.commission_percent));
    setBankName(d.transfer_bank_name || '');
    setAccountNumber(d.transfer_account_number || '');
    setAccountName(d.transfer_account_name || '');
    setSibling(String(d.sibling_discount_percent));
    setGuarantee(String(d.satisfaction_guarantee_hours));
    setInstantFee(String(d.instant_payout_fee_percent));
  }

  useEffect(() => {
    settings.get().then(applySettings).catch((e) => setError(e.message));
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const d = await settings.update({
        commission_percent: Number(commission),
        transfer_bank_name: bankName,
        transfer_account_number: accountNumber,
        transfer_account_name: accountName,
        sibling_discount_percent: Number(sibling),
        satisfaction_guarantee_hours: Number(guarantee),
        instant_payout_fee_percent: Number(instantFee),
      });
      applySettings(d);
      setSuccess('Settings saved. This applies to every payment initialized from now on.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout>
      <h1>Platform settings</h1>
      <p>Controls that apply platform-wide.</p>

      {error && <div className="lt-error-banner">{error}</div>}
      {success && <div className="lt-success-banner">{success}</div>}

      <div className="lt-card" style={{ maxWidth: 420 }}>
        <form onSubmit={handleSave}>
          <div className="lt-field">
            <label htmlFor="settings-f1">Platform commission (%)</label>
            <input id="settings-f1" type="number" min="0" max="100" value={commission} onChange={(e) => setCommission(e.target.value)} />
            <p className="lt-helper-text" style={{ fontSize: '0.8rem', marginTop: 4 }}>
              The percentage of every booking payment the platform keeps. The rest goes to the tutor.
            </p>
          </div>

          <hr style={{ margin: '20px 0', border: 'none', borderTop: '1px solid var(--lt-border, #e5e5e5)' }} />

          <h3 style={{ marginTop: 0 }}>Direct transfer account</h3>
          <p className="lt-helper-text" style={{ fontSize: '0.8rem', marginTop: -8, marginBottom: 12 }}>
            Shown to parents who choose "Direct transfer" at checkout. Leave blank to hide that option.
          </p>

          <div className="lt-field">
            <label htmlFor="settings-f2">Bank name</label>
            <input id="settings-f2" type="text" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. GTBank" />
          </div>
          <div className="lt-field">
            <label htmlFor="settings-f3">Account number</label>
            <input id="settings-f3" type="text" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="e.g. 0123456789" />
          </div>
          <div className="lt-field">
            <label htmlFor="settings-f4">Account name</label>
            <input id="settings-f4" type="text" value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="e.g. LessonTeacher Ltd" />
          </div>

          <h3>Pricing rules</h3>
          <div className="lt-field">
            <label htmlFor="settings-f5">Sibling discount (%)</label>
            <input id="settings-f5" type="number" min="0" max="100" value={sibling} onChange={(e) => setSibling(e.target.value)} />
            <small>Taken off at checkout when a parent has two or more active children.</small>
          </div>
          <div className="lt-field">
            <label htmlFor="settings-f6">Refund / reschedule window (hours)</label>
            <input id="settings-f6" type="number" min="0" max="8760" value={guarantee} onChange={(e) => setGuarantee(e.target.value)} />
            <small>How long after a completed lesson a parent can request a refund or reschedule.</small>
          </div>
          <div className="lt-field">
            <label htmlFor="settings-f7">Instant payout fee (%)</label>
            <input id="settings-f7" type="number" min="0" max="100" value={instantFee} onChange={(e) => setInstantFee(e.target.value)} />
            <small>Charged to tutors who take their earnings immediately instead of in the normal batch.</small>
          </div>

          <button className="lt-btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </form>
      </div>
    </Layout>
  );
}
