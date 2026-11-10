import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import ConfirmButton from '../../components/ConfirmButton';
import { lessonMaterials, curriculum } from '../../api/client';

export default function Materials() {
  const [list, setList] = useState([]);
  const [curriculumUnits, setCurriculumUnits] = useState([]);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', curriculum_unit_id: '', file: null, is_premium: false, price: '' });

  const load = () => lessonMaterials.mine().then((d) => setList(d.materials)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    curriculum.list().then((d) => setCurriculumUnits(d.curriculum_units)).catch(() => {});
  }, []);

  async function handleUpload(e) {
    e.preventDefault();
    if (!form.file || !form.title) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', form.file);
      fd.append('title', form.title);
      if (form.description) fd.append('description', form.description);
      if (form.curriculum_unit_id) fd.append('curriculum_unit_id', form.curriculum_unit_id);
      if (form.is_premium) {
        if (!Number(form.price) || Number(form.price) <= 0) { setError('Enter a price for a paid material.'); setUploading(false); return; }
        fd.append('is_premium', 'true');
        fd.append('price', form.price);
      }
      await lessonMaterials.upload(fd);
      setForm({ title: '', description: '', curriculum_unit_id: '', file: null, is_premium: false, price: '' });
      document.getElementById('material-file-input').value = '';
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove(id) {
    setError(null);
    try {
      await lessonMaterials.remove(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Layout>
      <h1>Lesson materials</h1>
      <p>Your content library — parents and students can see these once they have a confirmed booking with you.</p>

      {error && <div className="lt-error-banner">{error}</div>}

      <div className="lt-card" style={{ maxWidth: 480 }}>
        <h3>Upload material</h3>
        <form onSubmit={handleUpload}>
          <div className="lt-field">
            <label htmlFor="materials-f1">Title</label>
            <input id="materials-f1" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
          </div>
          <div className="lt-field">
            <label htmlFor="materials-f2">Description</label>
            <input id="materials-f2" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="lt-field">
            <label htmlFor="materials-f3">Curriculum unit (optional)</label>
            <select id="materials-f3" value={form.curriculum_unit_id} onChange={(e) => setForm((f) => ({ ...f, curriculum_unit_id: e.target.value }))}>
              <option value="">— None —</option>
              {curriculumUnits.map((u) => <option key={u.id} value={u.id}>{u.title}</option>)}
            </select>
          </div>
          <div className="lt-field">
            <label htmlFor="material-file-input">File</label>
            <input id="material-file-input" type="file" onChange={(e) => setForm((f) => ({ ...f, file: e.target.files[0] }))} required />
          </div>
          <div className="lt-field">
            <label><input type="checkbox" checked={form.is_premium} onChange={(e) => setForm((f) => ({ ...f, is_premium: e.target.checked }))} /> Paid material (students unlock it for a fee)</label>
          </div>
          {form.is_premium && (
            <div className="lt-field">
              <label htmlFor="material-price">Price (NGN)</label>
              <input id="material-price" type="number" min="1" step="any" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} required />
            </div>
          )}
          <button className="lt-btn" type="submit" disabled={uploading}>{uploading ? 'Uploading…' : 'Upload'}</button>
        </form>
      </div>

      <div className="lt-card" style={{ marginTop: 16 }}>
        <table className="lt-table">
          <thead><tr><th>Title</th><th>Type</th><th>Price</th><th></th><th></th></tr></thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id}>
                <td data-label="Title">{m.title}{m.description && <div className="lt-helper-text" style={{ fontSize: '0.8rem' }}>{m.description}</div>}</td>
                <td data-label="Type" style={{ textTransform: 'uppercase', fontSize: '0.75rem' }}>{m.file_type}</td>
                <td data-label="Price">{m.is_premium ? `${m.currency} ${m.price}` : 'Free'}</td>
                <td data-label="File"><a href={m.file_url} target="_blank" rel="noreferrer">View</a></td>
                <td><ConfirmButton confirmLabel="Yes, remove" onConfirm={() => handleRemove(m.id)}>Remove</ConfirmButton></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <div className="lt-empty">No materials uploaded yet.</div>}
      </div>
    </Layout>
  );
}
