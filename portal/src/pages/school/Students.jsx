import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { schools } from '../../api/client';

export default function SchoolStudents() {
  const [students, setStudents] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [parentIdentifier, setParentIdentifier] = useState('');
  const [foundParent, setFoundParent] = useState(null);
  const [foundChildren, setFoundChildren] = useState([]);
  const [lookupError, setLookupError] = useState(null);
  const [fullName, setFullName] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [saving, setSaving] = useState(null); // holds which action is in flight: 'new' or a child id

  const load = () => schools.children().then((d) => setStudents(d.children)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function handleLookup(e) {
    e.preventDefault();
    setLookupError(null);
    setFoundParent(null);
    setFoundChildren([]);
    try {
      const { parent, children } = await schools.lookupParent(parentIdentifier);
      setFoundParent(parent);
      setFoundChildren(children || []);
    } catch (err) {
      setLookupError(err.message);
    }
  }

  async function linkExistingChild(child) {
    setSaving(child.id);
    setError(null);
    setSuccess(null);
    try {
      await schools.addChild({ child_id: child.id });
      setSuccess(`${child.full_name} added to your roster.`);
      setFoundParent(null);
      setFoundChildren([]);
      setParentIdentifier('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  }

  async function handleAddNewStudent(e) {
    e.preventDefault();
    if (!foundParent || !fullName) return;
    setSaving('new');
    setError(null);
    setSuccess(null);
    try {
      await schools.addChild({ parent_id: foundParent.id, full_name: fullName, grade_level: gradeLevel });
      setSuccess(`${fullName} added to your roster.`);
      setFullName('');
      setGradeLevel('');
      setFoundParent(null);
      setFoundChildren([]);
      setParentIdentifier('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Layout>
      <h1>Students</h1>
      <p>Parents already need an account first — look them up by the email or phone they signed up with, then add their child to your roster.</p>

      {error && <div className="lt-error-banner">{error}</div>}
      {success && <div className="lt-success-banner">{success}</div>}

      <div className="lt-card" style={{ maxWidth: 480 }}>
        <h3>Add a student</h3>
        <form onSubmit={handleLookup} className="lt-row" style={{ alignItems: 'flex-end' }}>
          <div className="lt-field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="students-f1">Parent's email or phone</label>
            <input id="students-f1" value={parentIdentifier} onChange={(e) => setParentIdentifier(e.target.value)} />
          </div>
          <button className="lt-btn lt-btn--secondary" type="submit">Look up</button>
        </form>
        {lookupError && <p style={{ color: 'var(--lt-danger-fg)', marginTop: 8 }}>{lookupError}</p>}

        {foundParent && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--lt-border)', paddingTop: 16 }}>
            <p style={{ marginBottom: 12 }}>Parent found: <strong>{foundParent.full_name}</strong></p>

            {foundChildren.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <p className="lt-helper-text" style={{ fontSize: '0.85rem', marginBottom: 8 }}>
                  {foundParent.full_name} already has {foundChildren.length === 1 ? 'a child' : 'children'} in the
                  system — link the right one instead of creating a duplicate:
                </p>
                {foundChildren.map((c) => (
                  <div key={c.id} className="lt-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                    <span>{c.full_name} {c.grade_level ? `(${c.grade_level})` : ''}{c.school_id ? ' — already linked to a school' : ''}</span>
                    <button
                      className="lt-btn lt-btn--sm"
                      disabled={saving === c.id || !!c.school_id}
                      onClick={() => linkExistingChild(c)}
                    >
                      {saving === c.id ? 'Linking…' : 'Link'}
                    </button>
                  </div>
                ))}
                <p className="lt-helper-text" style={{ fontSize: '0.8rem', marginTop: 8 }}>
                  None of these? Add a new one below.
                </p>
              </div>
            )}

            <form onSubmit={handleAddNewStudent}>
              <div className="lt-field">
                <label htmlFor="students-f2">Student's full name</label>
                <input id="students-f2" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
              <div className="lt-field">
                <label htmlFor="students-f3">Grade level</label>
                <input id="students-f3" value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} placeholder="e.g. Primary 4" />
              </div>
              <button className="lt-btn" type="submit" disabled={saving === 'new'}>{saving === 'new' ? 'Adding…' : 'Add as new student'}</button>
            </form>
          </div>
        )}
      </div>

      <div className="lt-card" style={{ marginTop: 16 }}>
        <table className="lt-table">
          <thead><tr><th>Name</th><th>Grade</th></tr></thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id}><td data-label="Name">{s.full_name}</td><td data-label="Grade">{s.grade_level || '—'}</td></tr>
            ))}
          </tbody>
        </table>
        {students.length === 0 && <div className="lt-empty">No students on your roster yet.</div>}
      </div>
    </Layout>
  );
}
