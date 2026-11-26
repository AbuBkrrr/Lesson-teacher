import React, { useEffect, useRef, useState } from 'react';
import IntroVideo from '../../components/IntroVideo';
import Layout from '../../components/Layout';
import { useAuth } from '../../contexts/AuthContext';
import { localInputToIso, nowLocalInput, formatAvailability, browserTimeZone } from '../../utils/time';
import { tutors, children, bookings, auditions, skills, matching } from '../../api/client';

const CATEGORIES = ['', 'academic', 'mental', 'physical', 'creative', 'life', 'career'];

export default function FindTutor() {
  const { user } = useAuth();
  const [catalog, setCatalog] = useState([]);
  const [filters, setFilters] = useState({ category: '', skill_id: '', min_rate: '', max_rate: '', min_rating: '', city: '', online: '' });
  const [result, setResult] = useState({ tutors: [], page: 1, total_pages: 1 });
  const [myChildren, setMyChildren] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [bookingForm, setBookingForm] = useState({});
  const [recommended, setRecommended] = useState(null); // null = off, else array
  const [favoriteIds, setFavoriteIds] = useState(new Set());

  useEffect(() => {
    skills.list().then((d) => setCatalog(d.skills)).catch(() => {});
    if (user?.role === 'parent') children.mine().then((d) => setMyChildren(d.children)).catch(() => {});
    tutors.favorites().then((d) => setFavoriteIds(new Set(d.tutors.map((t) => t.user_id)))).catch(() => {});
  }, []);

  async function toggleFavorite(tutorId) {
    const isFav = favoriteIds.has(tutorId);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      isFav ? next.delete(tutorId) : next.add(tutorId);
      return next;
    });
    try {
      await (isFav ? tutors.removeFavorite(tutorId) : tutors.addFavorite(tutorId));
    } catch (e) {
      // Revert on failure.
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        isFav ? next.add(tutorId) : next.delete(tutorId);
        return next;
      });
      setError(e.message);
    }
  }

  // Only the latest request may update the list — otherwise a slow, older
  // (e.g. unfiltered) response can overwrite the filtered results.
  const searchSeq = useRef(0);
  const search = (page = 1) => {
    const seq = ++searchSeq.current;
    tutors.list({ ...filters, page, page_size: 12 })
      .then((d) => { if (seq === searchSeq.current) setResult(d); })
      .catch((e) => { if (seq === searchSeq.current) setError(e.message); });
  };
  useEffect(() => { search(1); }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateFilter(field, value) {
    setFilters((f) => ({ ...f, [field]: value, ...(field === 'category' ? { skill_id: '' } : {}) }));
  }

  const skillsForCategory = filters.category ? catalog.filter((s) => s.category === filters.category) : catalog;

  function toggleRecommended() {
    if (recommended) { setRecommended(null); return; }
    if (!filters.skill_id) { setError('Pick a specific skill first to get a match score.'); return; }
    matching.recommended(filters.skill_id, { max_rate: filters.max_rate }).then((d) => setRecommended(d.recommended_tutors)).catch((e) => setError(e.message));
  }

  function updateForm(tutorId, field, value) {
    setBookingForm((f) => ({ ...f, [tutorId]: { ...f[tutorId], [field]: value } }));
  }

  async function requestAudition(tutorId) {
    setBusyId(tutorId);
    setError(null);
    setSuccess(null);
    try {
      const form = bookingForm[tutorId] || {};
      const type = form.auditionType || 'video';
      if (type === 'challenge' && !form.brief?.trim()) { setError('Describe the challenge task for the tutor.'); return; }
      await auditions.create({
        tutor_id: tutorId, type, brief: form.brief?.trim() || undefined,
        child_id: form.childId || undefined, skill_id: form.skillId || undefined,
      });
      setSuccess('Audition requested — track it under Auditions.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function requestBooking(tutorId) {
    const form = bookingForm[tutorId] || {};
    setError(null);
    setSuccess(null);
    if (form.scheduledAt && new Date(form.scheduledAt).getTime() < Date.now()) { setError('That time is in the past — pick a future date and time.'); return; }
    if (!form.scheduledAt) { setError('Pick a preferred date and time so the tutor knows when you want the lesson.'); return; }
    setBusyId(tutorId);
    try {
      const weeks = Number(form.weeks || 1);
      const res = await bookings.create({
        tutor_id: tutorId, child_id: form.childId || undefined, skill_id: form.skillId || undefined,
        subject: form.subject || undefined, scheduled_at: localInputToIso(form.scheduledAt) || undefined,
        duration_minutes: Number(form.duration || 60),
        ...(weeks > 1 ? { recurrence: { weeks } } : {}),
      });
      setSuccess(res.bookings ? `${res.bookings.length} weekly lessons requested — track them under Bookings.` : 'Booking requested — track it under Bookings.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Layout>
      <h1>Find a tutor</h1>
      <p>Filter by skill, budget, or rating, then request an audition or book directly.</p>

      {error && <div className="lt-error-banner">{error}</div>}
      {success && <div className="lt-success-banner">{success}</div>}

      <div className="lt-card">
        <div className="lt-grid lt-grid--filters">
          <div className="lt-field" style={{ marginBottom: 0 }}>
            <label htmlFor="findtutor-f1">Category</label>
            <select id="findtutor-f1" value={filters.category} onChange={(e) => updateFilter('category', e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c || 'All categories'}</option>)}
            </select>
          </div>
          <div className="lt-field" style={{ marginBottom: 0 }}>
            <label htmlFor="findtutor-f1-2">Skill</label>
            <select id="findtutor-f1-2" value={filters.skill_id} onChange={(e) => updateFilter('skill_id', e.target.value)}>
              <option value="">All skills</option>
              {skillsForCategory.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
            </select>
          </div>
          <div className="lt-field" style={{ marginBottom: 0 }}>
            <label htmlFor="findtutor-f2">Min rate</label>
            <input id="findtutor-f2" type="number" value={filters.min_rate} onChange={(e) => updateFilter('min_rate', e.target.value)} />
          </div>
          <div className="lt-field" style={{ marginBottom: 0 }}>
            <label htmlFor="findtutor-f3">Max rate</label>
            <input id="findtutor-f3" type="number" value={filters.max_rate} onChange={(e) => updateFilter('max_rate', e.target.value)} />
          </div>
          <div className="lt-field" style={{ marginBottom: 0 }}>
            <label htmlFor="findtutor-f4">Min rating</label>
            <input id="findtutor-f4" type="number" min="0" max="5" step="0.5" value={filters.min_rating} onChange={(e) => updateFilter('min_rating', e.target.value)} />
          </div>
          <div className="lt-field" style={{ marginBottom: 0 }}>
            <label htmlFor="findtutor-f2-2">City</label>
            <input id="findtutor-f2-2" value={filters.city} onChange={(e) => updateFilter('city', e.target.value)} placeholder="e.g. Lagos" />
          </div>
          <div className="lt-field" style={{ marginBottom: 0 }}>
            <label htmlFor="findtutor-f3-2">Teaching mode</label>
            <select id="findtutor-f3-2" value={filters.online} onChange={(e) => updateFilter('online', e.target.value)}>
              <option value="">Any mode</option>
              <option value="true">Online only</option>
              <option value="false">In-person only</option>
            </select>
          </div>
        </div>
      </div>

      <button className="lt-btn lt-btn--secondary" style={{ marginTop: 12 }} onClick={toggleRecommended}>
        {recommended ? 'Show all results' : '✨ Show best matches for this skill'}
      </button>

      {recommended && (
        <div className="lt-grid" style={{ marginTop: 16 }}>
          {recommended.map((t) => (
            <div className="lt-card" key={t.tutor_id}>
              <h3>{t.full_name} {t.platform_verified && <span className="lt-badge lt-badge--success">Platform-verified</span>}</h3>
              <p>{t.currency} {t.hourly_rate}/hr · ★ {t.rating?.toFixed(1)} ({t.review_count} reviews)</p>
              <p className="lt-helper-text" style={{ fontSize: '0.8rem' }}>Match score: {t.score} (rating {t.score_breakdown.rating_score}, verified +{t.score_breakdown.verified_bonus}, price fit +{t.score_breakdown.price_fit})</p>
            </div>
          ))}
          {recommended.length === 0 && <div className="lt-card lt-empty">No matches for this skill yet.</div>}
        </div>
      )}

      {!recommended && <div className="lt-grid" style={{ marginTop: 16 }}>
        {result.tutors.map((t) => (
          <div className="lt-card" key={t.id}>
            <h3>
              {t.full_name} {t.platform_verified ? <span className="lt-badge lt-badge--success" title="Staff-reviewed on Lesson Teacher">Platform-verified</span> : null}
              <button
                type="button"
                onClick={() => toggleFavorite(t.user_id)}
                title={favoriteIds.has(t.user_id) ? 'Remove from saved tutors' : 'Save this tutor'}
                aria-label={favoriteIds.has(t.user_id) ? 'Unsave tutor' : 'Save tutor'}
                style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}
              >
                {favoriteIds.has(t.user_id) ? '★' : '☆'}
              </button>
            </h3>
            <p style={{ marginBottom: 6 }}>
              {(t.skills || []).map((s) => `${s.icon || ''} ${s.name}`).join(', ') || 'No skills listed yet'}
            </p>
            {t.hourly_rate && <p style={{ marginBottom: 6 }}>{t.currency} {t.hourly_rate}/hr {t.rating > 0 && `\u00b7 \u2605 ${t.rating.toFixed(1)}`}</p>}
            {(t.city || t.country) && <p style={{ marginBottom: 6, fontSize: '0.85rem' }}>{[t.city, t.country].filter(Boolean).join(', ')} {t.teaches_online ? '\u00b7 online' : ''} {t.teaches_in_person ? '\u00b7 in-person' : ''}</p>}
            {t.bio && <p style={{ fontSize: '0.875rem' }}>{t.bio}</p>}
            <IntroVideo url={t.intro_video_url} name={t.full_name} />
            {t.availability?.length > 0 && (
              <p style={{ fontSize: '0.85rem', marginBottom: 6 }}>
                <strong>Teaches:</strong> {formatAvailability(t.availability)} <span className="lt-helper-text">({t.timezone || 'Africa/Lagos'})</span>
              </p>
            )}

            <div className="lt-field">
              <label htmlFor={`findtutor-f5-${t.user_id}`}>Child (optional)</label>
              <select id={`findtutor-f5-${t.user_id}`} value={bookingForm[t.user_id]?.childId || ''} onChange={(e) => updateForm(t.user_id, 'childId', e.target.value)}>
                <option value="">— Select —</option>
                {myChildren.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </div>
            {(t.skills || []).length > 0 && (
              <div className="lt-field">
                <label htmlFor={`findtutor-f8-${t.user_id}`}>Skill</label>
                <select id={`findtutor-f8-${t.user_id}`} value={bookingForm[t.user_id]?.skillId || ''} onChange={(e) => updateForm(t.user_id, 'skillId', e.target.value)}>
                  <option value="">— Select —</option>
                  {t.skills.map((sk) => <option key={sk.skill_id} value={sk.skill_id}>{sk.name}</option>)}
                </select>
              </div>
            )}
            <div className="lt-field">
              <label htmlFor={`findtutor-f6-${t.user_id}`}>Subject</label>
              <input id={`findtutor-f6-${t.user_id}`} value={bookingForm[t.user_id]?.subject || ''} onChange={(e) => updateForm(t.user_id, 'subject', e.target.value)} />
            </div>
            <div className="lt-field">
              <label htmlFor={`findtutor-f7-${t.user_id}`}>Preferred date/time (required for a booking)</label>
              <input id={`findtutor-f7-${t.user_id}`} type="datetime-local" min={nowLocalInput()} value={bookingForm[t.user_id]?.scheduledAt || ''} onChange={(e) => updateForm(t.user_id, 'scheduledAt', e.target.value)} />
              <span className="lt-helper-text">Times are in your time zone ({browserTimeZone()}).</span>
            </div>
            <div className="lt-row">
              <div className="lt-field" style={{ flex: 1 }}>
                <label htmlFor={`findtutor-f9-${t.user_id}`}>Lesson length</label>
                <select id={`findtutor-f9-${t.user_id}`} value={bookingForm[t.user_id]?.duration || '60'} onChange={(e) => updateForm(t.user_id, 'duration', e.target.value)}>
                  {[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min{t.hourly_rate ? ` · ${t.currency} ${Math.round(t.hourly_rate * m / 60)}` : ''}</option>)}
                </select>
              </div>
              <div className="lt-field" style={{ flex: 1 }}>
                <label htmlFor={`findtutor-f10-${t.user_id}`}>Repeat</label>
                <select id={`findtutor-f10-${t.user_id}`} value={bookingForm[t.user_id]?.weeks || '1'} onChange={(e) => updateForm(t.user_id, 'weeks', e.target.value)}>
                  <option value="1">One lesson</option>
                  {[2, 4, 6, 8, 12].map((w) => <option key={w} value={w}>Weekly for {w} weeks</option>)}
                </select>
              </div>
            </div>
            <details className="lt-audition-options">
              <summary>Audition options</summary>
              <div className="lt-field">
                <label htmlFor={`findtutor-f11-${t.user_id}`}>Audition type</label>
                <select id={`findtutor-f11-${t.user_id}`} value={bookingForm[t.user_id]?.auditionType || 'video'} onChange={(e) => updateForm(t.user_id, 'auditionType', e.target.value)}>
                  <option value="video">Video: a short recorded sample lesson</option>
                  <option value="live">Live: a short session at an agreed time</option>
                  <option value="portfolio">Portfolio: examples of past work</option>
                  <option value="challenge">Challenge: a task you set</option>
                </select>
              </div>
              <div className="lt-field">
                <label htmlFor={`findtutor-f12-${t.user_id}`}>{bookingForm[t.user_id]?.auditionType === 'challenge' ? 'Challenge task (required)' : 'Note for the tutor (optional)'}</label>
                <textarea id={`findtutor-f12-${t.user_id}`} rows={2} maxLength={2000} value={bookingForm[t.user_id]?.brief || ''} onChange={(e) => updateForm(t.user_id, 'brief', e.target.value)} />
              </div>
            </details>

            <div className="lt-row">
              <button className="lt-btn" disabled={busyId === t.user_id} onClick={() => requestBooking(t.user_id)}>Request booking</button>
              <button className="lt-btn lt-btn--secondary" disabled={busyId === t.user_id} onClick={() => requestAudition(t.user_id)}>Request audition</button>
            </div>
          </div>
        ))}
      </div>}
      {!recommended && result.tutors.length === 0 && <div className="lt-empty">No tutors match these filters.</div>}

      {!recommended && result.total_pages > 1 && (
        <div className="lt-row" style={{ marginTop: 16, justifyContent: 'center' }}>
          <button className="lt-btn lt-btn--ghost" disabled={result.page <= 1} onClick={() => search(result.page - 1)}>Previous</button>
          <span>Page {result.page} of {result.total_pages}</span>
          <button className="lt-btn lt-btn--ghost" disabled={result.page >= result.total_pages} onClick={() => search(result.page + 1)}>Next</button>
        </div>
      )}
    </Layout>
  );
}
