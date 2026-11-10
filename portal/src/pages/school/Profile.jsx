import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { schools } from '../../api/client';

export default function SchoolProfile() {
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    schools.mine().then((d) => setForm(d.school)).catch((e) => setError(e.message));
  }, []);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { school } = await schools.update({
        name: form.name, address: form.address, contact_email: form.contact_email, contact_phone: form.contact_phone,
      });
      setForm(school);
      setSuccess('School profile updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <Layout><p>Loading…</p></Layout>;

  return (
    <Layout>
      <h1>School profile</h1>
      <p>This information is shown to parents and used for your join code.</p>

      {error && <div className="lt-error-banner">{error}</div>}
      {success && <div className="lt-success-banner">{success}</div>}

      <div className="lt-card" style={{ maxWidth: 480 }}>
        <form onSubmit={handleSave}>
          <div className="lt-field">
            <label htmlFor="profile-f1">School name</label>
            <input id="profile-f1" value={form.name || ''} onChange={update('name')} />
          </div>
          <div className="lt-field">
            <label htmlFor="profile-f2">Address</label>
            <input id="profile-f2" value={form.address || ''} onChange={update('address')} />
          </div>
          <div className="lt-field">
            <label htmlFor="profile-f3">Contact email</label>
            <input id="profile-f3" value={form.contact_email || ''} onChange={update('contact_email')} />
          </div>
          <div className="lt-field">
            <label htmlFor="profile-f4">Contact phone</label>
            <input id="profile-f4" value={form.contact_phone || ''} onChange={update('contact_phone')} />
          </div>
          <div className="lt-field">
            <label htmlFor="profile-f5">Join code (share with parents to link their child)</label>
            <input id="profile-f5" value={form.join_code || ''} readOnly disabled style={{ background: 'var(--lt-bg)' }} />
          </div>
          <button className="lt-btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </form>
      </div>
    </Layout>
  );
}
