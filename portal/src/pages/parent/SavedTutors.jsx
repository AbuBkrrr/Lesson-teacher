import React, { useEffect, useState } from 'react';
import IntroVideo from '../../components/IntroVideo';
import Layout from '../../components/Layout';
import { tutors } from '../../api/client';

export default function SavedTutors() {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    tutors.favorites().then((d) => setList(d.tutors)).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function unsave(tutorId) {
    setList((prev) => prev.filter((t) => t.user_id !== tutorId));
    try {
      await tutors.removeFavorite(tutorId);
    } catch (e) {
      setError(e.message);
      load();
    }
  }

  if (!list) return <Layout><p>Loading…</p></Layout>;

  return (
    <Layout>
      <h1>Saved tutors</h1>
      <p>Tutors you've bookmarked while browsing — handy for comparing before you book.</p>

      {error && <div className="lt-error-banner">{error}</div>}

      {list.length === 0 && (
        <div className="lt-empty">
          No saved tutors yet. Tap the ☆ on any tutor card in{' '}
          <a href="#/parent/browse">Browse all</a> to save them here.
        </div>
      )}

      <div className="lt-grid" style={{ marginTop: 16 }}>
        {list.map((t) => (
          <div className="lt-card" key={t.user_id}>
            <h3>
              {t.full_name}
              <button
                type="button"
                onClick={() => unsave(t.user_id)}
                title="Remove from saved tutors"
                aria-label="Unsave tutor"
                style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}
              >
                {'★'}
              </button>
            </h3>
            <p style={{ marginBottom: 6 }}>{(t.subjects || []).join(', ') || 'No subjects listed yet'}</p>
            {t.hourly_rate && <p style={{ marginBottom: 6 }}>{t.currency} {t.hourly_rate}/hr {t.rating > 0 && `· ★ ${Number(t.rating).toFixed(1)}`}</p>}
            <IntroVideo url={t.intro_video_url} name={t.full_name} />
            {(t.city || t.country) && <p style={{ fontSize: '0.85rem' }}>{[t.city, t.country].filter(Boolean).join(', ')}</p>}
          </div>
        ))}
      </div>
    </Layout>
  );
}
