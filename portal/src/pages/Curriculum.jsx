import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import ConfirmButton from '../components/ConfirmButton';
import { curriculum, skills } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export default function Curriculum() {
  const { user } = useAuth();
  const canManage = user?.role === 'super_admin' || user?.role === 'school_admin';

  const [list, setList] = useState([]);
  const [skillOptions, setSkillOptions] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', skill_id: '', grade_level: '' });
  const [saving, setSaving] = useState(false);

  const load = () => curriculum.list().then((d) => setList(d.curriculum_units)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    skills.list().then((d) => setSkillOptions(d.skills)).catch(() => {});
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.title) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await curriculum.create(form);
      setForm({ title: '', description: '', skill_id: '', grade_level: '' });
      setSuccess('Curriculum unit added.');
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
      await curriculum.remove(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Layout>
      <h1>Curriculum</h1>
      <p>
        {user?.role === 'super_admin' && 'The global curriculum library, plus anything schools have added.'}
        {user?.role === 'school_admin' && "The global curriculum library, plus your own school's units."}
        {!canManage && 'Reference material for lesson planning.'}
      </p>

      {error && <div className="lt-error-banner">{error}</div>}
      {success && <div className="lt-success-banner">{success}</div>}

      {canManage && (
        <div className="lt-card" style={{ maxWidth: 480 }}>
          <h3>Add a curriculum unit</h3>
          <form onSubmit={handleCreate}>
            <div className="lt-field">
              <label htmlFor="curriculum-f1">Title</label>
              <input id="curriculum-f1" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
            </div>
            <div className="lt-field">
              <label htmlFor="curriculum-f2">Description</label>
              <input id="curriculum-f2" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="lt-field">
              <label htmlFor="curriculum-f3">Skill (optional)</label>
              <select id="curriculum-f3" value={form.skill_id} onChange={(e) => setForm((f) => ({ ...f, skill_id: e.target.value }))}>
                <option value="">— None —</option>
                {skillOptions.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
              </select>
            </div>
            <div className="lt-field">
              <label htmlFor="curriculum-f1-2">Grade level</label>
              <input id="curriculum-f1-2" value={form.grade_level} onChange={(e) => setForm((f) => ({ ...f, grade_level: e.target.value }))} placeholder="e.g. Primary 4" />
            </div>
            <button className="lt-btn" type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add unit'}</button>
            <p className="lt-helper-text" style={{ fontSize: '0.8rem', marginTop: 8 }}>
              {user?.role === 'super_admin' ? 'Added to the global library, visible to everyone.' : "Added to your school's own curriculum."}
            </p>
          </form>
        </div>
      )}

      <div className="lt-card" style={{ marginTop: 16 }}>
        <table className="lt-table">
          <thead><tr><th>Title</th><th>Skill</th><th>Grade</th><th>Scope</th>{canManage && <th></th>}</tr></thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id}>
                <td data-label="Title">{u.title}{u.description && <div className="lt-helper-text" style={{ fontSize: '0.8rem' }}>{u.description}</div>}</td>
                <td data-label="Skill">{u.skill_name || '—'}</td>
                <td data-label="Grade">{u.grade_level || '—'}</td>
                <td data-label="Scope">{u.school_id ? (u.school_name || 'School') : <span className="lt-badge lt-badge--info">Global</span>}</td>
                {canManage && (
                  <td>
                    <ConfirmButton confirmLabel="Yes, remove" onConfirm={() => handleRemove(u.id)}>Remove</ConfirmButton>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <div className="lt-empty">No curriculum units yet.</div>}
      </div>
    </Layout>
  );
}
