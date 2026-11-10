import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { children, gamification } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export default function ChildBadges() {
  const { user } = useAuth();
  const [streak, setStreak] = useState(null);
  const [badges, setBadges] = useState([]);
  const [board, setBoard] = useState([]);
  const [me, setMe] = useState(null);
  const [noSchool, setNoSchool] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    children.me()
      .then(({ child }) => {
        setMe(child);
        return Promise.all([
          gamification.childStreak(child.id).then((d) => setStreak(d.streak)),
          gamification.childBadges(child.id).then((d) => setBadges(d.badges)),
          user?.school_id
            ? gamification.schoolLeaderboard().then((d) => setBoard([...d.leaderboard].sort((a, b) => b.total_points - a.total_points))).catch(() => {})
            : setNoSchool(true),
        ]);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Layout>
      <h1>Badges &amp; rank</h1>
      <p>Keep learning to build your streak and earn badges.</p>
      {error && <div className="lt-error-banner">{error}</div>}
      {loading && <p>Loading…</p>}

      {streak && (
        <div className="lt-grid lt-grid--stats">
          <div className="lt-card"><strong style={{ fontSize: '1.6rem' }}>🔥 {streak.current_streak}</strong><div>Day streak</div></div>
          <div className="lt-card"><strong style={{ fontSize: '1.6rem' }}>🏆 {streak.longest_streak}</strong><div>Best streak</div></div>
          <div className="lt-card"><strong style={{ fontSize: '1.6rem' }}>⭐ {streak.total_points}</strong><div>Points</div></div>
        </div>
      )}

      <div className="lt-card" style={{ marginTop: 16 }}>
        <h3>Earned badges</h3>
        {!loading && badges.length === 0 && <div className="lt-empty">No badges yet — keep learning to earn your first one!</div>}
        <div className="lt-grid">
          {badges.map((b) => (
            <div key={b.code} className="lt-card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32 }} aria-hidden="true">{b.icon || '🎖️'}</div>
              <strong>{b.name}</strong>
              {b.description && <div className="lt-helper-text">{b.description}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="lt-card" style={{ marginTop: 16 }}>
        <h3>School leaderboard</h3>
        {board.length === 0 ? <div className="lt-empty">{noSchool ? 'The leaderboard appears once your school links your account.' : 'No school leaderboard yet.'}</div> : (
          <table className="lt-table">
            <thead><tr><th>#</th><th>Name</th><th>Streak</th><th>Points</th></tr></thead>
            <tbody>
              {board.map((r, i) => (
                <tr key={r.child_id} style={me && r.child_id === me.id ? { fontWeight: 700 } : undefined}>
                  <td data-label="Rank">{i + 1}</td>
                  <td data-label="Name">{r.full_name || r.display_name}{me && r.child_id === me.id ? ' (you)' : ''}</td>
                  <td data-label="Streak">🔥 {r.current_streak}</td>
                  <td data-label="Points">⭐ {r.total_points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
