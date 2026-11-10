import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { skills } from '../../api/client';

const CATEGORIES = ['academic', 'mental', 'physical', 'creative', 'life', 'career'];

export default function TutorSkills() {
  const [catalog, setCatalog] = useState([]);
  const [mySkills, setMySkills] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [proficiency, setProficiency] = useState({});

  const load = () => {
    skills.list().then((d) => setCatalog(d.skills)).catch((e) => setError(e.message));
    skills.mine().then((d) => setMySkills(d.tutor_skills)).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const attachedIds = new Set(mySkills.map((s) => s.skill_id));

  async function attach(skillId) {
    setBusyId(skillId);
    setError(null);
    try {
      await skills.addMine(skillId, proficiency[skillId] || 'intermediate');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function detach(skillId) {
    setBusyId(skillId);
    setError(null);
    try {
      await skills.removeMine(skillId);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Layout>
      <h1>My skills</h1>
      <p>Parents filter tutors by skill when searching — attach the ones you teach, with your proficiency level.</p>

      {error && <div className="lt-error-banner">{error}</div>}

      {CATEGORIES.map((cat) => {
        const items = catalog.filter((s) => s.category === cat);
        if (items.length === 0) return null;
        return (
          <div className="lt-card" key={cat}>
            <h3 style={{ textTransform: 'capitalize' }}>{cat}</h3>
            {items.map((s) => {
              const attached = attachedIds.has(s.id);
              return (
                <div key={s.id} className="lt-row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--lt-border)' }}>
                  <div>{s.icon} {s.name}</div>
                  <div className="lt-row">
                    {!attached && (
                      <select
                        aria-label={`Proficiency for ${s.name}`}
                        value={proficiency[s.id] || 'intermediate'}
                        onChange={(e) => setProficiency((p) => ({ ...p, [s.id]: e.target.value }))}
                        style={{ padding: 6, borderRadius: 8, border: '1px solid var(--lt-border)' }}
                      >
                        <option value="beginner">Beginner</option>
                        <option value="intermediate">Intermediate</option>
                        <option value="expert">Expert</option>
                      </select>
                    )}
                    <button
                      className={`lt-btn lt-btn--sm ${attached ? 'lt-btn--danger' : ''}`}
                      disabled={busyId === s.id}
                      onClick={() => (attached ? detach(s.id) : attach(s.id))}
                    >
                      {attached ? 'Remove' : 'Add'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </Layout>
  );
}
