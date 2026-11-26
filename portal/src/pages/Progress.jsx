import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { children as childrenApi, progress } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'];
const LEVEL_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', expert: 'Expert' };

function Stat({ label, value }) {
  return <div className="lt-card lt-stat"><strong>{value}</strong><span className="lt-muted">{label}</span></div>;
}

export default function Progress() {
  const { user } = useAuth();
  const isChild = user?.role === 'child';
  const [params, setParams] = useSearchParams();
  const [kids, setKids] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const childId = params.get('child') || '';

  useEffect(() => {
    if (isChild) return;
    childrenApi.mine().then((d) => {
      setKids(d.children);
      if (!childId && d.children[0]) setParams({ child: d.children[0].id }, { replace: true });
    }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChild]);

  useEffect(() => {
    setError(null);
    if (isChild) { progress.me().then(setData).catch((e) => setError(e.message)); return; }
    if (!childId) { setData(null); return; }
    progress.child(childId).then(setData).catch((e) => setError(e.message));
  }, [isChild, childId]);

  const s = data?.summary;
  return (
    <Layout>
      <h1>{isChild ? 'My progress' : 'Progress reports'}</h1>
      {!isChild && kids.length > 1 && (
        <div className="lt-field" style={{ maxWidth: 320 }}>
          <label htmlFor="progress-child">Child</label>
          <select id="progress-child" value={childId} onChange={(e) => setParams({ child: e.target.value })}>
            {kids.map((k) => <option key={k.id} value={k.id}>{k.full_name}</option>)}
          </select>
        </div>
      )}
      {!isChild && kids.length === 0 && <div className="lt-card lt-empty">Add a child under My children to see their progress.</div>}
      {error && <div className="lt-error-banner">{error}</div>}

      {data && (
        <>
          <section className="lt-progress-grid" aria-label="Summary">
            <Stat label="Lessons completed" value={s.completed_lessons} />
            <Stat label="Hours learned" value={s.hours_learned} />
            <Stat label="Average score" value={s.average_score ?? '—'} />
            <Stat label="Day streak" value={s.streak?.current ?? 0} />
            <Stat label="Assignments graded" value={`${s.assignments.graded}/${s.assignments.total}`} />
          </section>

          <h2>Skills</h2>
          {data.skills.length === 0 && <div className="lt-card lt-empty">Skill levels appear after the first completed lesson linked to a skill.</div>}
          <div className="lt-progress-grid">
            {data.skills.map((sk) => {
              const step = LEVELS.indexOf(sk.level) + 1;
              return (
                <div key={sk.skill_id} className="lt-card lt-stat">
                  <strong style={{ fontSize: '1.1rem' }}>{sk.icon} {sk.skill_name}</strong>
                  <span>{LEVEL_LABEL[sk.level]} · {sk.completed_lessons} lesson{sk.completed_lessons === 1 ? '' : 's'}{sk.average_score !== null ? ` · avg ${sk.average_score}` : ''}</span>
                  <div className="lt-meter" role="meter" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step} aria-label={`${sk.skill_name} level`}>
                    <span style={{ width: `${step * 25}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {data.upcoming_lessons.length > 0 && (
            <>
              <h2>Coming up</h2>
              <ul className="lt-card">
                {data.upcoming_lessons.map((l) => <li key={l.id}>{new Date(l.scheduled_at).toLocaleString()} · {l.subject || 'Lesson'} with {l.tutor_name}</li>)}
              </ul>
            </>
          )}

          <h2>Tutor reports</h2>
          {data.recent_reports.length === 0 && <div className="lt-card lt-empty">No lesson reports yet.</div>}
          {data.recent_reports.map((r) => (
            <article key={r.id} className="lt-card">
              <h3 style={{ marginTop: 0 }}>{r.skill_name || r.subject || 'Lesson'} · {new Date(r.scheduled_at || r.created_at).toLocaleDateString()}</h3>
              <p className="lt-muted">By {r.tutor_name}{r.score !== null ? ` · score ${r.score}/100` : ''}{r.engagement ? ` · engagement ${r.engagement}/5` : ''}</p>
              <p>{r.summary}</p>
              {r.strengths && <p><strong>Strengths:</strong> {r.strengths}</p>}
              {r.next_steps && <p><strong>Next steps:</strong> {r.next_steps}</p>}
              {r.homework && <p><strong>Homework:</strong> {r.homework}</p>}
            </article>
          ))}

          {data.badges.length > 0 && (
            <>
              <h2>Badges</h2>
              <p>{data.badges.map((b) => `${b.icon || '🏅'} ${b.name}`).join('  ·  ')}</p>
            </>
          )}
        </>
      )}
    </Layout>
  );
}
