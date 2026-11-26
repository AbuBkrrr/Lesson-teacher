import React, { useState } from 'react';
import { getAttribution } from '../utils/tracking';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const HOME_BY_ROLE = {
  school_admin: '/school',
  tutor: '/tutor',
  parent: '/parent',
  adult_student: '/parent',
};

const ROLES = [
  { value: 'parent', label: 'Parent', blurb: 'Book tutors and manage your children’s lessons.' },
  { value: 'adult_student', label: 'Adult Student (18+)', blurb: 'Learn directly — no parent account needed.' },
  { value: 'tutor', label: 'Tutor', blurb: 'Teach, get booked, and get paid.' },
  { value: 'school_admin', label: 'School', blurb: 'Manage students, tutors, and curriculum for your school.' },
];

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [role, setRole] = useState(['parent', 'tutor', 'adult_student', 'school_admin'].includes(params.get('role')) ? params.get('role') : 'parent');
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', school_name: '', date_of_birth: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (role === 'adult_student' && !form.date_of_birth) {
      setError('Date of birth is required to sign up as an adult student');
      return;
    }

    setSubmitting(true);
    try {
      const payload = { role, full_name: form.full_name, password: form.password };
      if (form.email) payload.email = form.email;
      if (form.phone) payload.phone = form.phone;
      if (role === 'school_admin') payload.school_name = form.school_name;
      if (role === 'adult_student') payload.date_of_birth = form.date_of_birth;
      const attribution = getAttribution();
      if (attribution) payload.attribution = attribution;

      const user = await signup(payload);
      navigate(HOME_BY_ROLE[user.role] || '/');
    } catch (err) {
      setError(err.message || 'Signup failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lt-auth-screen">
      <div className="lt-auth-card">
        <div className="lt-auth-logo">Lesson Teacher</div>
        <div className="lt-auth-tagline">Create your account</div>

        {error && <div className="lt-error-banner">{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {ROLES.map((r) => (
            <label
              key={r.value}
              style={{
                display: 'flex', flexDirection: 'column', border: role === r.value ? '2px solid #4f46e5' : '1px solid #ddd',
                borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="radio" name="role" value={r.value} checked={role === r.value} onChange={() => setRole(r.value)} />
                <strong>{r.label}</strong>
              </span>
              <span style={{ fontSize: '0.8rem', color: '#666', marginLeft: 24 }}>{r.blurb}</span>
            </label>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="lt-field">
            <label htmlFor="full_name">Full name</label>
            <input id="full_name" value={form.full_name} onChange={(e) => setField('full_name', e.target.value)} required />
          </div>
          <div className="lt-field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
          </div>
          <div className="lt-field">
            <label htmlFor="phone">Phone (optional if email given)</label>
            <input id="phone" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
          </div>
          {role === 'adult_student' && (
            <div className="lt-field">
              <label htmlFor="date_of_birth">Date of birth</label>
              <input id="date_of_birth" type="date" value={form.date_of_birth} onChange={(e) => setField('date_of_birth', e.target.value)} required />
              <small style={{ color: '#666' }}>You must be 18 or older to sign up as an adult student.</small>
            </div>
          )}
          {role === 'school_admin' && (
            <div className="lt-field">
              <label htmlFor="school_name">School name</label>
              <input id="school_name" value={form.school_name} onChange={(e) => setField('school_name', e.target.value)} required />
            </div>
          )}
          <div className="lt-field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={form.password} onChange={(e) => setField('password', e.target.value)} autoComplete="new-password" required minLength={8} />
          </div>
          <button className="lt-btn" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
            {submitting ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p style={{ marginTop: 16, fontSize: '0.85rem' }}>
          All new accounts must verify their identity before booking or teaching a lesson — you'll be asked to upload an ID after signing up.
        </p>
        <p style={{ marginTop: 8, fontSize: '0.85rem' }}>
          Already have an account? <Link to="/login">Sign in</Link>.
        </p>
      </div>
    </div>
  );
}
