import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';
import GettingStarted from '../../components/GettingStarted';
import { useAuth } from '../../contexts/AuthContext';
import { parents } from '../../api/client';

export default function ParentHome() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const { user } = useAuth();

  useEffect(() => {
    parents.dashboard().then(setData).catch((e) => setError(e.message));
  }, []);

  return (
    <Layout>
      <h1>Home</h1>
      <p>{user?.role === 'parent' ? "Everything with your children's tutoring, at a glance." : 'Your tutors and lessons, at a glance.'}</p>

      {error && <div className="lt-error-banner">{error}</div>}

      {data && (
        <>
          <GettingStarted
            storageKey={`parent_${user?.id}`}
            steps={[
              ...(user?.role === 'parent' ? [{ label: 'Add your child', done: data.children_count > 0, to: '/parent/children' }] : []),
              { label: 'Find a tutor', done: data.active_tutors_count > 0 || data.tutors.length > 0, to: '/parent/discover' },
              { label: 'Verify your email', done: !!user?.email_verified_at || !user?.email, to: '/account' },
            ]}
          />

          <div className="lt-grid lt-grid--stats">
            {user?.role === 'parent' && <StatCard label="Children" value={data.children_count} />}
            <StatCard label="Active tutors" value={data.active_tutors_count} />
            <StatCard label="Lessons this month" value={data.lessons_this_month_count} />
          </div>

          {user?.role === 'parent' && <div className="lt-card" style={{ marginTop: 16 }}>
            <div className="lt-row-between">
              <h3 style={{ margin: 0 }}>My children</h3>
              <Link to="/parent/children">Manage →</Link>
            </div>
            {data.children.length === 0 ? (
              <div className="lt-empty">No children added yet — <Link to="/parent/children">add your first child</Link> to start booking lessons.</div>
            ) : (
              <table className="lt-table" style={{ marginTop: 12 }}>
                <thead><tr><th>Name</th><th>Grade</th><th>Subjects</th><th>Login</th></tr></thead>
                <tbody>
                  {data.children.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Name">{c.full_name}</td>
                      <td data-label="Grade">{c.grade_level || '—'}</td>
                      <td data-label="Subjects">{c.subjects.length > 0 ? c.subjects.join(', ') : '—'}</td>
                      <td data-label="Login">{c.has_login ? <StatusBadge status="active" /> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>}

          <div className="lt-card" style={{ marginTop: 16 }}>
            <div className="lt-row-between">
              <h3 style={{ margin: 0 }}>Your tutors</h3>
              <Link to="/parent/bookings">View bookings →</Link>
            </div>
            {data.tutors.length === 0 ? (
              <div className="lt-empty">No tutors yet — <Link to="/parent/discover">find one</Link>.</div>
            ) : (
              <table className="lt-table" style={{ marginTop: 12 }}>
                <thead><tr><th>Name</th><th>Subjects</th><th>Rating</th><th>Status</th></tr></thead>
                <tbody>
                  {data.tutors.map((t) => (
                    <tr key={t.id}>
                      <td data-label="Name">{t.full_name}</td>
                      <td data-label="Subjects">{t.subjects.length > 0 ? t.subjects.join(', ') : '—'}</td>
                      <td data-label="Rating">{t.rating > 0 ? `★ ${t.rating.toFixed(1)} (${t.review_count})` : 'New'}</td>
                      <td data-label="Status"><StatusBadge status={t.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
