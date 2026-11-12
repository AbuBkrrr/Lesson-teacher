import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QrCode from '../../components/QrCode';
import Layout from '../../components/Layout';
import ConfirmButton from '../../components/ConfirmButton';
import { children, childInvites, gamification } from '../../api/client';

export default function MyChildren() {
  const [list, setList] = useState([]);
  const [streaks, setStreaks] = useState({}); // child_id -> streak row
  const [leaderboard, setLeaderboard] = useState([]);
  const [error, setError] = useState(null);
  const [fullName, setFullName] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [age, setAge] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [learningNeeds, setLearningNeeds] = useState('');
  const [saving, setSaving] = useState(false);
  const [inviteInfo, setInviteInfo] = useState(null); // { code, expires_at, child_name }
  const [busyId, setBusyId] = useState(null);

  const load = () => children.mine().then((d) => {
    setList(d.children);
    d.children.forEach((c) => {
      gamification.childStreak(c.id).then((s) => setStreaks((prev) => ({ ...prev, [c.id]: s.streak }))).catch(() => {});
    });
    gamification.siblingLeaderboard().then((d) => setLeaderboard(d.leaderboard)).catch(() => {});
  }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function handleAdd(e) {
    e.preventDefault();
    if (!fullName) return;
    setSaving(true);
    setError(null);
    try {
      await children.create({
        full_name: fullName, grade_level: gradeLevel, age: age === '' ? undefined : Number(age),
        school_name: schoolName, learning_needs: learningNeeds,
      });
      setFullName('');
      setGradeLevel('');
      setAge('');
      setSchoolName('');
      setLearningNeeds('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id) {
    setError(null);
    try {
      await children.remove(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleGrantLogin(childId) {
    setBusyId(childId);
    setError(null);
    try {
      const info = await childInvites.create(childId);
      setInviteInfo(info);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Layout>
      <h1>My children</h1>
      <p>Add each child you want to book tutoring sessions for.</p>

      {error && <div className="lt-error-banner">{error}</div>}

      {inviteInfo && (
        <div className="lt-card" style={{ borderColor: 'var(--lt-primary)', maxWidth: 480 }}>
          <h3>Login code for {inviteInfo.child_name}</h3>
          <p>Give this code to {inviteInfo.child_name} — with you present, have them go to the login page, choose "I have a code," and enter it along with a username and password they pick themselves.</p>
          <div style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '0.1em', textAlign: 'center', padding: 16, background: 'var(--lt-bg)', borderRadius: 12 }}>
            {inviteInfo.code}
          </div>
          <div style={{ margin: '8px 0' }}>
            <QrCode value={`lessonteacher://invite?code=${inviteInfo.code}`} label={`Invite code ${inviteInfo.code} as a QR code`} />
            <p className="lt-helper-text">Or scan this with the Lesson Teacher app on your child's phone.</p>
          </div>
          <p className="lt-helper-text" style={{ fontSize: '0.8rem' }}>Expires {new Date(inviteInfo.expires_at).toLocaleString()}.</p>
          <button className="lt-btn lt-btn--ghost" onClick={() => { setInviteInfo(null); load(); }}>Done</button>
        </div>
      )}

      <div className="lt-card" style={{ maxWidth: 420 }}>
        <form onSubmit={handleAdd}>
          <div className="lt-field">
            <label htmlFor="mychildren-f1">Full name</label>
            <input id="mychildren-f1" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div className="lt-field">
            <label htmlFor="mychildren-f2">Grade level</label>
            <input id="mychildren-f2" value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} placeholder="e.g. Primary 4" />
          </div>
          <div className="lt-field">
            <label htmlFor="mychildren-f3">Age</label>
            <input id="mychildren-f3" type="number" min={1} max={25} value={age} onChange={(e) => setAge(e.target.value)} />
          </div>
          <div className="lt-field">
            <label htmlFor="mychildren-f4">School (optional)</label>
            <input id="mychildren-f4" value={schoolName} onChange={(e) => setSchoolName(e.target.value)} maxLength={200} />
          </div>
          <div className="lt-field">
            <label htmlFor="mychildren-f5">Learning needs (optional)</label>
            <textarea id="mychildren-f5" rows={2} maxLength={2000} value={learningNeeds} onChange={(e) => setLearningNeeds(e.target.value)}
              placeholder="e.g. dyslexia, prefers visual examples, short attention span" />
            <span className="lt-helper-text">Shared with tutors you book, so they can adapt their lessons.</span>
          </div>
          <button className="lt-btn" type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add child'}</button>
        </form>
      </div>

      <div className="lt-card" style={{ marginTop: 16 }}>
        <table className="lt-table">
          <thead><tr><th>Name</th><th>Grade</th><th>Progress</th><th>Their own login</th><th></th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td data-label="Name">{c.full_name}{c.age ? `, ${c.age}` : ''}{c.school_name && <div className="lt-helper-text">{c.school_name}</div>}{c.learning_needs && <div className="lt-helper-text">Needs: {c.learning_needs}</div>}</td>
                <td data-label="Grade">{c.grade_level || '—'}</td>
                <td data-label="Progress">
                  {streaks[c.id]
                    ? <span>🔥 {streaks[c.id].current_streak}-day streak · ⭐ {streaks[c.id].total_points} pts</span>
                    : <span className="lt-helper-text">—</span>}
                  <div><Link to={`/parent/progress?child=${c.id}`}>View progress report</Link></div>
                </td>
                <td data-label="Login">
                  {c.user_id
                    ? <span className="lt-badge lt-badge--success">Active</span>
                    : <button className="lt-btn lt-btn--sm" disabled={busyId === c.id} onClick={() => handleGrantLogin(c.id)}>Give login</button>}
                </td>
                <td><ConfirmButton confirmLabel="Yes, remove" label={`Remove ${c.full_name}`} onConfirm={() => handleRemove(c.id)}>Remove</ConfirmButton></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <div className="lt-empty">No children added yet.</div>}
      </div>

      {leaderboard.length > 1 && (
        <div className="lt-card" style={{ marginTop: 16 }}>
          <h3>Sibling leaderboard</h3>
          <ol>
            {[...leaderboard].sort((a, b) => b.total_points - a.total_points).map((r) => (
              <li key={r.child_id}>{r.full_name} — ⭐ {r.total_points} pts, 🔥 {r.current_streak}-day streak</li>
            ))}
          </ol>
        </div>
      )}
    </Layout>
  );
}
