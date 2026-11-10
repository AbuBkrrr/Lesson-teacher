import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import ConfirmButton from '../../components/ConfirmButton';
import { skills } from '../../api/client';

const CATEGORIES = ['academic', 'mental', 'physical', 'creative', 'life', 'career'];

export default function SuperAdminSkills() {
  const [catalog, setCatalog] = useState([]);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: '', category: 'academic', description: '', icon: '' });
  const [saving, setSaving] = useState(false);

  const load = () => skills.list().then((d) => setCatalog(d.skills)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleAdd(e) {
    e.preventDefault();
    if (!form.name) return;
    setSaving(true);
    setError(null);
    try {
      await skills.create(form);
      setForm({ name: '', category: 'academic', description: '', icon: '' });
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
      await skills.remove(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Layout>
      <h1>Skill catalog</h1>
      <p>The curated set of skills tutors can attach to their profile and parents filter by.</p>

      {error && <div className="lt-error-banner">{error}</div>}

      <div className="lt-card" style={{ maxWidth: 480 }}>
        <h3>Add a skill</h3>
        <form onSubmit={handleAdd}>
          <div className="lt-field">
            <label htmlFor="skills-f1">Name</label>
            <input id="skills-f1" value={form.name} onChange={update('name')} required />
          </div>
          <div className="lt-field">
            <label htmlFor="skills-f2">Category</label>
            <select id="skills-f2" value={form.category} onChange={update('category')}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="lt-field">
            <label htmlFor="skills-f1-2">Icon (emoji)</label>
            <input id="skills-f1-2" value={form.icon} onChange={update('icon')} placeholder="optional" />
          </div>
          <div className="lt-field">
            <label htmlFor="skills-f2-2">Description</label>
            <input id="skills-f2-2" value={form.description} onChange={update('description')} />
          </div>
          <button className="lt-btn" type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add skill'}</button>
        </form>
      </div>

      <div className="lt-card" style={{ marginTop: 16 }}>
        <table className="lt-table">
          <thead><tr><th></th><th>Name</th><th>Category</th><th></th></tr></thead>
          <tbody>
            {catalog.map((s) => (
              <tr key={s.id}>
                <td>{s.icon}</td>
                <td>{s.name}</td>
                <td style={{ textTransform: 'capitalize' }}>{s.category}</td>
                <td><ConfirmButton confirmLabel="Yes, remove" onConfirm={() => handleRemove(s.id)}>Remove</ConfirmButton></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
