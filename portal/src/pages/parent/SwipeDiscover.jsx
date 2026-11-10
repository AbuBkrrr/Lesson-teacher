import React, { useEffect, useRef, useState } from 'react';
import IntroVideo from '../../components/IntroVideo';
import Layout from '../../components/Layout';
import { useAuth } from '../../contexts/AuthContext';
import { skills, tutors, auditions, bookings, children } from '../../api/client';

const CATEGORY_LABELS = {
  academic: 'Academic', mental: 'Mental', physical: 'Physical',
  creative: 'Creative', life: 'Life Skills', career: 'Career',
};

export default function SwipeDiscover() {
  const { user } = useAuth();
  const [step, setStep] = useState('select-skills');
  const [skillsByCategory, setSkillsByCategory] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [city, setCity] = useState('');
  const [online, setOnline] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    skills.list().then((d) => {
      const grouped = {};
      d.skills.forEach((s) => { (grouped[s.category] ||= []).push(s); });
      setSkillsByCategory(grouped);
    }).catch((e) => setError(e.message));
  }, []);

  function toggleSkill(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (step === 'swipe') {
    return <SwipeStage selectedSkillIds={[...selected]} city={city} online={online} onBack={() => setStep('select-skills')} />;
  }

  return (
    <Layout>
      <h1>What does your child need help with?</h1>
      <p>Pick a few skills — we'll find tutors who teach them.</p>

      {error && <div className="lt-error-banner">{error}</div>}

      {Object.entries(skillsByCategory).map(([category, list]) => (
        <div key={category} style={{ marginBottom: 8 }}>
          <h3 style={{ fontSize: '0.95rem' }}>{CATEGORY_LABELS[category] || category}</h3>
          <div className="lt-skill-pill-group">
            {list.map((s) => (
              <button
                key={s.id}
                className={`lt-skill-pill${selected.has(s.id) ? ' selected' : ''}`}
                onClick={() => toggleSkill(s.id)}
                type="button"
              >
                {s.icon} {s.name} {selected.has(s.id) && '✓'}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="lt-field" style={{ maxWidth: 280 }}>
        <label htmlFor="swipediscover-f1">City (optional)</label>
        <input id="swipediscover-f1" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Lagos" />
      </div>
      <div className="lt-field" style={{ maxWidth: 280 }}>
        <label htmlFor="swipediscover-f2">Teaching mode</label>
        <select id="swipediscover-f2" value={online} onChange={(e) => setOnline(e.target.value)}>
          <option value="">Online or in-person</option>
          <option value="true">Online only</option>
          <option value="false">In-person only</option>
        </select>
      </div>

      <button className="lt-btn" style={{ maxWidth: 280 }} onClick={() => setStep('swipe')}>
        Find tutors →
      </button>
    </Layout>
  );
}

function SwipeStage({ selectedSkillIds, city, online, onBack }) {
  const { user } = useAuth();
  const [pool, setPool] = useState([]);
  const [index, setIndex] = useState(0);
  const [myChildren, setMyChildren] = useState([]);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [showDetail, setShowDetail] = useState(false);

  const [drag, setDrag] = useState({ dx: 0, dy: 0, dragging: false });
  const [exiting, setExiting] = useState(null);
  const startPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (user?.role === 'parent') children.mine().then((d) => setMyChildren(d.children)).catch(() => {});

    // Note: the backend's /api/tutors only supports filtering by one
    // skill_id at a time, so when a parent selects several skills we
    // use the first — good enough for v1, but a real limitation if
    // someone picks skills from multiple unrelated categories.
    const locationParams = { city: city || undefined, online: online || undefined };
    const fetchPromise = selectedSkillIds.length > 0
      ? tutors.list({ skill_id: selectedSkillIds[0], page_size: 50, ...locationParams })
      : tutors.list({ page_size: 50, ...locationParams });

    fetchPromise.then((d) => {
      setPool(d.tutors);
    }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = pool[index];

  function onPointerDown(e) {
    if (exiting) return;
    startPos.current = { x: e.clientX, y: e.clientY };
    setDrag({ dx: 0, dy: 0, dragging: true });
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (!drag.dragging) return;
    setDrag({ dx: e.clientX - startPos.current.x, dy: e.clientY - startPos.current.y, dragging: true });
  }
  function onPointerUp() {
    if (!drag.dragging) return;
    const threshold = 110;
    if (drag.dx > threshold) triggerSwipe('right');
    else if (drag.dx < -threshold) triggerSwipe('left');
    else setDrag({ dx: 0, dy: 0, dragging: false });
  }

  async function triggerSwipe(direction) {
    setExiting(direction);
    setDrag({ dx: 0, dy: 0, dragging: false });

    if (direction === 'right' && current) {
      try {
        await auditions.create({ tutor_id: current.user_id });
        setFeedback(`Audition requested with ${current.full_name}!`);
      } catch (err) {
        setFeedback(err.message);
      }
    }

    setTimeout(() => {
      setExiting(null);
      setShowDetail(false);
      setIndex((i) => i + 1);
      setTimeout(() => setFeedback(null), 2500);
    }, 320);
  }

  async function requestBooking() {
    if (!current) return;
    try {
      // Use the first of this tutor's actual matched skills as the subject
      // — reflects what they were found for, rather than leaving the tutor
      // to guess what the lesson request is even about.
      const subject = current.skills?.[0]?.name;
      await bookings.create({ tutor_id: current.user_id, child_id: myChildren[0]?.id, subject });
      setFeedback(`Booking requested with ${current.full_name}!`);
    } catch (err) {
      setFeedback(err.message);
    }
  }

  const cardStyle = exiting
    ? {}
    : drag.dragging
      ? { transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx / 18}deg)` }
      : {};
  const cardClass = [
    'lt-tutor-card',
    drag.dragging ? 'lt-tutor-card--dragging' : '',
    exiting === 'left' ? 'lt-tutor-card--exit-left' : '',
    exiting === 'right' ? 'lt-tutor-card--exit-right' : '',
  ].join(' ').trim();

  return (
    <Layout>
      <div className="lt-row-between">
        <h1>Discover tutors</h1>
        <button className="lt-btn lt-btn--ghost" onClick={onBack}>← Change skills</button>
      </div>

      {error && <div className="lt-error-banner">{error}</div>}
      {feedback && <div className="lt-success-banner">{feedback}</div>}

      {!current ? (
        <div className="lt-card lt-empty">
          {pool.length === 0 ? 'No tutors match yet — check back soon.' : "That's everyone! Try different skills for more matches."}
        </div>
      ) : (
        <>
          <div className="lt-swipe-stage">
            <div
              key={current.id}
              className={cardClass}
              style={cardStyle}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {drag.dx > 40 && <div className="lt-swipe-badge lt-swipe-badge--like">Interested</div>}
              {drag.dx < -40 && <div className="lt-swipe-badge lt-swipe-badge--nope">Pass</div>}

              {current.intro_video_url ? (
                // The card is draggable; keep video controls from starting a swipe.
                <IntroVideo url={current.intro_video_url} name={current.full_name} onPointerDown={(e) => e.stopPropagation()} style={{ margin: 0, borderRadius: 0, maxHeight: 200, objectFit: 'cover' }} />
              ) : (
                <div className="video-placeholder">{current.full_name?.[0] || '?'}</div>
              )}
              <div className="card-body">
                <div className="tutor-name">
                  {current.full_name}
                  {current.rating > 0 && <span className="badge">★ Top rated</span>}
                  {current.platform_verified && <span className="badge" title="Staff-reviewed on Lesson Teacher">✔ Platform-verified</span>}
                </div>
                <div className="rating">★ {current.rating?.toFixed(1) || 'New'} <span>({current.review_count || 0} reviews)</span></div>
                <div className="skills">
                  {(current.skills || []).map((s) => <span key={s.name} className="skill-tag">{s.icon} {s.name}</span>)}
                </div>
                {showDetail && current.bio && <p style={{ fontSize: '0.85rem', color: 'var(--lt-muted)' }}>{current.bio}</p>}
                <div className="meta-row">
                  <span>{current.currency} {current.hourly_rate || '—'}/hr</span>
                  <span>{current.qualifications || 'Qualifications on request'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="lt-swipe-actions">
            <button className="swipe-btn dislike" onClick={() => triggerSwipe('left')} aria-label="Pass">✕</button>
            <button className="swipe-btn detail" onClick={() => setShowDetail((v) => !v)} aria-label="Details">i</button>
            <button className="swipe-btn like" onClick={() => triggerSwipe('right')} aria-label="Interested">♥</button>
          </div>

          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button className="lt-btn lt-btn--secondary" style={{ maxWidth: 240, margin: '0 auto' }} onClick={requestBooking}>
              Book directly instead
            </button>
          </div>
        </>
      )}
    </Layout>
  );
}
