import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import IntroVideoEditor from '../../components/IntroVideoEditor';
import GettingStarted from '../../components/GettingStarted';
import { useAuth } from '../../contexts/AuthContext';
import { tutors, skills, lessonMaterials } from '../../api/client';

const CURRENCIES = ['NGN', 'KES', 'UGX', 'GHS', 'ZAR', 'TZS', 'XOF', 'USD', 'EUR', 'GBP'];

export default function TutorProfile() {
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();
  const [counts, setCounts] = useState({ skills: null, slots: null, materials: 0 });

  useEffect(() => {
    tutors.myProfile().then((d) => setForm(d.profile)).catch((e) => setError(e.message));
    Promise.all([skills.mine().catch(() => null), tutors.myAvailability().catch(() => null), lessonMaterials.mine().catch(() => null)]).then(([sk, av, mat]) => {
      const list = (x, k) => (x ? (Array.isArray(x) ? x : x[k]) : null);
      setCounts({ skills: list(sk, 'skills')?.length ?? null, slots: list(av, 'slots')?.length ?? null, materials: list(mat, 'materials')?.length ?? 0 });
    });
  }, []);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { profile } = await tutors.updateMyProfile({
        qualifications: form.qualifications,
        hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
        currency: form.currency || 'NGN',
        bio: form.bio,
        city: form.city,
        country: form.country,
        teaches_online: form.teaches_online !== false,
        teaches_in_person: !!form.teaches_in_person,
      });
      setForm(profile);
      setSuccess('Profile updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <Layout><p>Loading…</p></Layout>;

  return (
    <Layout>
      <h1>My profile</h1>
      <p>Your bio, rate, and qualifications — this is what parents see on your card.</p>

      {counts.skills !== null && counts.slots !== null && (
        <GettingStarted
          storageKey={`tutor_${user?.id}`}
          steps={[
            { label: 'Write your bio and set your rate', done: !!form.bio && !!form.hourly_rate, to: '/tutor' },
            { label: 'Add at least one skill', done: counts.skills > 0, to: '/tutor/skills' },
            { label: 'Publish your weekly availability', done: counts.slots > 0, to: '/tutor/availability' },
            { label: 'Add an introduction video (optional, 1–2 min)', done: !!form.intro_video_url, to: '/tutor' },
            { label: 'Upload your first lesson material', done: counts.materials > 0, to: '/tutor/materials' },
            { label: 'Verify your email', done: !!user?.email_verified_at || !user?.email, to: '/account' },
          ]}
        />
      )}

      <div className="lt-card" style={{ maxWidth: 520, borderColor: 'var(--lt-primary)' }}>
        <strong>Want to show up when parents search by skill?</strong>{' '}
        This page's fields don't control that — skills and proficiency levels are managed
        separately on{' '}
        <Link to="/tutor/skills" style={{ textDecoration: 'underline' }}>My skills</Link>. Without at least one skill added there,
        you won't appear in skill-filtered discovery no matter what you fill in below.
      </div>

      {error && <div className="lt-error-banner">{error}</div>}
      {success && <div className="lt-success-banner">{success}</div>}

      <div className="lt-card" style={{ maxWidth: 520 }}>
        <form onSubmit={handleSave}>
          <div className="lt-field">
            <label htmlFor="profile-f1">Qualifications</label>
            <input id="profile-f1" value={form.qualifications || ''} onChange={update('qualifications')} placeholder="B.Ed Mathematics" />
          </div>
          <div className="lt-row">
            <div className="lt-field" style={{ flex: 1 }}>
              <label htmlFor="profile-f2">Hourly rate</label>
              <input id="profile-f2" type="number" value={form.hourly_rate ?? ''} onChange={update('hourly_rate')} />
            </div>
            <div className="lt-field" style={{ width: 120 }}>
              <label htmlFor="profile-f3">Currency</label>
              <select id="profile-f3" value={form.currency || 'NGN'} onChange={update('currency')}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="lt-field">
            <label htmlFor="profile-f1-2">Bio</label>
            <textarea id="profile-f1-2" rows={4} value={form.bio || ''} onChange={update('bio')} />
          </div>
          <IntroVideoEditor profile={form} onChange={(next) => setForm((f) => ({ ...f, ...next }))} />
          <div className="lt-row">
            <div className="lt-field" style={{ flex: 1 }}>
              <label htmlFor="profile-f2-2">City</label>
              <input id="profile-f2-2" value={form.city || ''} onChange={update('city')} placeholder="e.g. Lagos" />
            </div>
            <div className="lt-field" style={{ flex: 1 }}>
              <label htmlFor="profile-f3-2">Country</label>
              <input id="profile-f3-2" value={form.country || ''} onChange={update('country')} placeholder="e.g. Nigeria" />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <input type="checkbox" checked={form.teaches_online !== false} onChange={(e) => setForm((f) => ({ ...f, teaches_online: e.target.checked }))} />
            I teach online
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <input type="checkbox" checked={!!form.teaches_in_person} onChange={(e) => setForm((f) => ({ ...f, teaches_in_person: e.target.checked }))} />
            I teach in person
          </label>
          <button className="lt-btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
        </form>
      </div>
    </Layout>
  );
}
