import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { lessonMaterials, bookings, materialPurchases } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export default function StudentMaterials() {
  const { user } = useAuth();
  const [byTutor, setByTutor] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    bookings.mine().then(async (d) => {
      const seen = new Map();
      d.bookings.filter((b) => ['confirmed', 'completed'].includes(b.status)).forEach((b) => {
        if (!seen.has(b.tutor_id)) seen.set(b.tutor_id, b.tutor_name);
      });

      const groups = await Promise.all(
        [...seen.entries()].map(async ([tutorId, tutorName]) => {
          try {
            const res = await lessonMaterials.forTutor(tutorId);
            return { tutorId, tutorName, materials: res.materials };
          } catch {
            return { tutorId, tutorName, materials: [] };
          }
        })
      );
      setByTutor(groups.filter((g) => g.materials.length > 0));
    }).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  async function handlePurchase(materialId) {
    setBusyId(materialId);
    setError(null);
    try {
      await materialPurchases.purchase(materialId);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Layout>
      <h1>Lesson materials</h1>
      <p>Shared by your tutors.</p>

      {error && <div className="lt-error-banner">{error}</div>}

      {byTutor.map((g) => (
        <div className="lt-card" key={g.tutorId} style={{ marginBottom: 16 }}>
          <h3>{g.tutorName}</h3>
          <table className="lt-table">
            <thead><tr><th>Title</th><th>Type</th><th></th></tr></thead>
            <tbody>
              {g.materials.map((m) => (
                <tr key={m.id}>
                  <td data-label="Title">{m.title}{m.description && <div className="lt-helper-text" style={{ fontSize: '0.8rem' }}>{m.description}</div>}</td>
                  <td data-label="Type" style={{ textTransform: 'uppercase', fontSize: '0.75rem' }}>{m.file_type}</td>
                  <td data-label="File">
                    {m.locked
                      ? (['parent', 'adult_student'].includes(user?.role)
                        ? <button className="lt-btn lt-btn--sm" disabled={busyId === m.id} onClick={() => handlePurchase(m.id)}>
                            {busyId === m.id ? 'Unlocking…' : `Unlock (${m.currency} ${m.price})`}
                          </button>
                        : <span className="lt-helper-text">🔒 Ask a parent to unlock</span>)
                      : <a href={m.file_url} target="_blank" rel="noreferrer">View</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {byTutor.length === 0 && <div className="lt-card lt-empty">No materials shared yet.</div>}
    </Layout>
  );
}
