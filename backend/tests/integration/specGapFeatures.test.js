const request = require('supertest');
const db = require('../../src/config/db');
const { getApp, signupTutor, signupParent, verifyUser } = require('../helpers');
const { levelFor } = require('../../src/services/progress');

const app = getApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function verifiedTutor(rate = 4000) {
  const { res } = await signupTutor(app);
  await verifyUser(res.body.user.id);
  await request(app).put('/api/tutors/me').set(auth(res.body.access_token)).send({ hourly_rate: rate, currency: 'NGN', subjects: [] });
  return { id: res.body.user.id, token: res.body.access_token };
}

async function verifiedParent() {
  const { res } = await signupParent(app);
  await verifyUser(res.body.user.id);
  return { id: res.body.user.id, token: res.body.access_token };
}

async function aSkill() {
  const existing = await db.prepare("SELECT id, name FROM skills WHERE name = 'Gap Test Maths' AND deleted_at IS NULL").get();
  if (existing) return existing;
  const id = `skill-${Date.now()}`;
  const ts = new Date().toISOString();
  await db.prepare("INSERT INTO skills (id, name, category, created_at, updated_at) VALUES (?, 'Gap Test Maths', 'academic', ?, ?)").run(id, ts, ts);
  return { id, name: 'Gap Test Maths' };
}

function futureIso(days, hourUtc = 9) {
  const d = new Date(Date.now() + days * 86400000);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
}

describe('child profile fields', () => {
  it('stores age, school and learning needs, and validates age', async () => {
    const parent = await verifiedParent();
    const bad = await request(app).post('/api/children').set(auth(parent.token)).send({ full_name: 'Ada', age: 40 });
    expect(bad.status).toBe(400);

    const ok = await request(app).post('/api/children').set(auth(parent.token))
      .send({ full_name: 'Ada', age: 9, grade_level: 'Primary 4', school_name: 'Sunrise School', learning_needs: 'Dyslexia: prefers audio' });
    expect(ok.status).toBe(201);
    expect(ok.body.child).toMatchObject({ age: 9, school_name: 'Sunrise School', learning_needs: 'Dyslexia: prefers audio' });

    const upd = await request(app).patch(`/api/children/${ok.body.child.id}`).set(auth(parent.token)).send({ age: 10 });
    expect(upd.body.child).toMatchObject({ age: 10, school_name: 'Sunrise School', full_name: 'Ada' });
  });
});

describe('audition types and parent review', () => {
  it('requires a brief for a challenge, a time for a live audition, and lets the parent rate + accept', async () => {
    const tutor = await verifiedTutor();
    const parent = await verifiedParent();
    const skill = await aSkill();
    const child = (await request(app).post('/api/children').set(auth(parent.token)).send({ full_name: 'Kid' })).body.child;

    const noBrief = await request(app).post('/api/auditions').set(auth(parent.token)).send({ tutor_id: tutor.id, type: 'challenge' });
    expect(noBrief.status).toBe(400);
    const badType = await request(app).post('/api/auditions').set(auth(parent.token)).send({ tutor_id: tutor.id, type: 'telepathy' });
    expect(badType.status).toBe(400);

    const ch = await request(app).post('/api/auditions').set(auth(parent.token))
      .send({ tutor_id: tutor.id, type: 'challenge', brief: 'Explain fractions to a 9 year old', child_id: child.id, skill_id: skill.id });
    expect(ch.status).toBe(201);
    expect(ch.body.audition).toMatchObject({ type: 'challenge', child_name: 'Kid', skill_name: skill.name, status: 'pending' });

    // Parent can't review before the tutor submits.
    const early = await request(app).patch(`/api/auditions/${ch.body.audition.id}/review`).set(auth(parent.token)).send({ rating: 5, decision: 'accepted' });
    expect(early.status).toBe(400);

    const noLink = await request(app).patch(`/api/auditions/${ch.body.audition.id}/status`).set(auth(tutor.token)).send({ status: 'ready' });
    expect(noLink.status).toBe(400);
    const ready = await request(app).patch(`/api/auditions/${ch.body.audition.id}/status`).set(auth(tutor.token))
      .send({ status: 'ready', video_url: 'https://example.com/answer', tutor_note: 'Used pizza slices' });
    expect(ready.status).toBe(200);
    expect(ready.body.audition.tutor_note).toBe('Used pizza slices');

    // Only the requesting parent can review.
    const other = await verifiedParent();
    const stranger = await request(app).patch(`/api/auditions/${ch.body.audition.id}/review`).set(auth(other.token)).send({ rating: 5, decision: 'accepted' });
    expect(stranger.status).toBe(403);
    const badRating = await request(app).patch(`/api/auditions/${ch.body.audition.id}/review`).set(auth(parent.token)).send({ rating: 9, decision: 'accepted' });
    expect(badRating.status).toBe(400);

    const reviewed = await request(app).patch(`/api/auditions/${ch.body.audition.id}/review`).set(auth(parent.token))
      .send({ rating: 4, decision: 'accepted', feedback: 'Clear and kind' });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.audition).toMatchObject({ status: 'completed', rating: 4, decision: 'accepted', feedback: 'Clear and kind' });

    const live = await request(app).post('/api/auditions').set(auth(parent.token)).send({ tutor_id: tutor.id, type: 'live' });
    const liveNoTime = await request(app).patch(`/api/auditions/${live.body.audition.id}/status`).set(auth(tutor.token)).send({ status: 'ready' });
    expect(liveNoTime.status).toBe(400);
    const liveOk = await request(app).patch(`/api/auditions/${live.body.audition.id}/status`).set(auth(tutor.token)).send({ status: 'ready', scheduled_at: futureIso(2) });
    expect(liveOk.status).toBe(200);
    expect(liveOk.body.audition.scheduled_at).toBe(futureIso(2));

    const notes = await db.prepare("SELECT type FROM notifications WHERE user_id = ? AND type IN ('audition_requested','audition_reviewed')").all(tutor.id);
    expect(notes.map((n) => n.type)).toEqual(expect.arrayContaining(['audition_requested', 'audition_reviewed']));
  });
});

describe('bookings: skill, duration, price, recurring series', () => {
  it('fixes the price from rate x duration and validates duration', async () => {
    const tutor = await verifiedTutor(4000);
    const parent = await verifiedParent();
    const skill = await aSkill();

    const bad = await request(app).post('/api/bookings').set(auth(parent.token)).send({ tutor_id: tutor.id, duration_minutes: 50 });
    expect(bad.status).toBe(400);

    const b = await request(app).post('/api/bookings').set(auth(parent.token))
      .send({ tutor_id: tutor.id, skill_id: skill.id, duration_minutes: 90, scheduled_at: futureIso(3) });
    expect(b.status).toBe(201);
    expect(Number(b.body.booking.price)).toBe(6000);
    expect(b.body.booking).toMatchObject({ duration_minutes: 90, subject: skill.name, skill_id: skill.id });

    // A later rate change doesn't change the agreed price.
    await request(app).put('/api/tutors/me').set(auth(tutor.token)).send({ hourly_rate: 10000, currency: 'NGN', subjects: [] });
    await request(app).patch(`/api/bookings/${b.body.booking.id}/status`).set(auth(tutor.token)).send({ status: 'confirmed' });
    const init = await request(app).post('/api/payments/initialize').set(auth(parent.token)).send({ booking_id: b.body.booking.id });
    expect(init.status).toBe(201);
    expect(Number(init.body.amount)).toBe(6000);
  });

  it('creates a weekly series, rejects the whole series on a clash, and confirms the series in one call', async () => {
    const tutor = await verifiedTutor(3000);
    const parent = await verifiedParent();
    const first = futureIso(5, 14);

    const tooMany = await request(app).post('/api/bookings').set(auth(parent.token)).send({ tutor_id: tutor.id, scheduled_at: first, recurrence: { weeks: 20 } });
    expect(tooMany.status).toBe(400);
    const noTime = await request(app).post('/api/bookings').set(auth(parent.token)).send({ tutor_id: tutor.id, recurrence: { weeks: 3 } });
    expect(noTime.status).toBe(400);

    // Block week 3 with another parent's confirmed lesson.
    const blocker = await verifiedParent();
    const week3 = new Date(new Date(first).getTime() + 14 * 86400000).toISOString();
    const blk = await request(app).post('/api/bookings').set(auth(blocker.token)).send({ tutor_id: tutor.id, scheduled_at: week3 });
    await request(app).patch(`/api/bookings/${blk.body.booking.id}/status`).set(auth(tutor.token)).send({ status: 'confirmed' });

    const clash = await request(app).post('/api/bookings').set(auth(parent.token)).send({ tutor_id: tutor.id, scheduled_at: first, recurrence: { weeks: 4 } });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatch(/week 3/);
    const leftovers = await db.prepare('SELECT COUNT(*) AS c FROM bookings WHERE parent_id = ?').get(parent.id);
    expect(Number(leftovers.c)).toBe(0);

    await request(app).patch(`/api/bookings/${blk.body.booking.id}/status`).set(auth(tutor.token)).send({ status: 'cancelled' });
    const series = await request(app).post('/api/bookings').set(auth(parent.token)).send({ tutor_id: tutor.id, scheduled_at: first, recurrence: { weeks: 4 } });
    expect(series.status).toBe(201);
    expect(series.body.bookings).toHaveLength(4);
    expect(new Set(series.body.bookings.map((b) => b.series_id)).size).toBe(1);
    expect(series.body.bookings[1].scheduled_at).toBe(new Date(new Date(first).getTime() + 7 * 86400000).toISOString());

    const conf = await request(app).patch(`/api/bookings/${series.body.booking.id}/status`).set(auth(tutor.token)).send({ status: 'confirmed', apply_to_series: true });
    expect(conf.status).toBe(200);
    expect(conf.body.updated_ids).toHaveLength(4);
    const statuses = await db.prepare('SELECT status FROM bookings WHERE series_id = ?').all(series.body.series_id);
    expect(statuses.every((s) => s.status === 'confirmed')).toBe(true);

    // The parent cancels the rest of the series.
    const cancel = await request(app).patch(`/api/bookings/${series.body.bookings[1].id}/status`).set(auth(parent.token)).send({ status: 'cancelled', apply_to_series: true });
    expect(cancel.body.updated_ids).toHaveLength(4);
  });
});

describe('lesson reports and progress', () => {
  it('tutor writes a report, completion updates skill progress, parent and child can read it, strangers cannot', async () => {
    const tutor = await verifiedTutor(2000);
    const parent = await verifiedParent();
    const skill = await aSkill();
    const child = (await request(app).post('/api/children').set(auth(parent.token)).send({ full_name: 'Learner', age: 8 })).body.child;

    const b = await request(app).post('/api/bookings').set(auth(parent.token)).send({ tutor_id: tutor.id, child_id: child.id, skill_id: skill.id, scheduled_at: futureIso(1) });
    const bookingId = b.body.booking.id;

    const tooEarly = await request(app).put(`/api/bookings/${bookingId}/report`).set(auth(tutor.token)).send({ summary: 'x' });
    expect(tooEarly.status).toBe(400); // still pending

    await request(app).patch(`/api/bookings/${bookingId}/status`).set(auth(tutor.token)).send({ status: 'confirmed' });
    const init = await request(app).post('/api/payments/initialize').set(auth(parent.token)).send({ booking_id: bookingId });
    await request(app).post('/api/payments/mock/complete').set(auth(parent.token)).send({ reference: init.body.reference });

    const noSummary = await request(app).put(`/api/bookings/${bookingId}/report`).set(auth(tutor.token)).send({ score: 80 });
    expect(noSummary.status).toBe(400);
    const badScore = await request(app).put(`/api/bookings/${bookingId}/report`).set(auth(tutor.token)).send({ summary: 'ok', score: 150 });
    expect(badScore.status).toBe(400);

    const report = await request(app).put(`/api/bookings/${bookingId}/report`).set(auth(tutor.token))
      .send({ summary: 'Times tables 2-5', strengths: 'Quick recall', next_steps: '6-9 tables', homework: 'Worksheet A', score: 85, engagement: 5 });
    expect(report.status).toBe(201);

    const parentNote = await db.prepare("SELECT id FROM notifications WHERE user_id = ? AND type = 'lesson_report'").get(parent.id);
    expect(parentNote).toBeTruthy();

    const done = await request(app).patch(`/api/bookings/${bookingId}/status`).set(auth(tutor.token)).send({ status: 'completed' });
    expect(done.status).toBe(200);

    const prog = await request(app).get(`/api/progress/children/${child.id}`).set(auth(parent.token));
    expect(prog.status).toBe(200);
    expect(prog.body.summary).toMatchObject({ completed_lessons: 1, average_score: 85, hours_learned: 1 });
    expect(prog.body.skills[0]).toMatchObject({ skill_id: skill.id, completed_lessons: 1, level: 'beginner', average_score: 85 });
    expect(prog.body.recent_reports[0]).toMatchObject({ summary: 'Times tables 2-5', homework: 'Worksheet A' });

    const tutorView = await request(app).get(`/api/progress/children/${child.id}`).set(auth(tutor.token));
    expect(tutorView.status).toBe(200);

    const stranger = await verifiedParent();
    const denied = await request(app).get(`/api/progress/children/${child.id}`).set(auth(stranger.token));
    expect(denied.status).toBe(403);
    const deniedReport = await request(app).get(`/api/bookings/${bookingId}/report`).set(auth(stranger.token));
    expect(deniedReport.status).toBe(403);

    const family = await request(app).get('/api/progress/family').set(auth(parent.token));
    expect(family.body.children[0].summary.completed_lessons).toBe(1);

    // The child, once signed in through an invite, sees the same report.
    const invite = await request(app).post(`/api/children/${child.id}/invite`).set(auth(parent.token));
    const redeem = await request(app).post('/api/auth/child/redeem-invite')
      .send({ code: invite.body.code, username: `kid${Date.now()}`, password: 'KidPass1234' });
    expect(redeem.status).toBe(201);
    {
      const mine = await request(app).get('/api/progress/me').set(auth(redeem.body.access_token));
      expect(mine.status).toBe(200);
      expect(mine.body.summary.completed_lessons).toBe(1);
      const childReport = await request(app).get(`/api/bookings/${bookingId}/report`).set(auth(redeem.body.access_token));
      expect(childReport.status).toBe(200);
    }
  });

  it('levels follow lesson count and average score', () => {
    expect(levelFor(0, null)).toBe('beginner');
    expect(levelFor(4, null)).toBe('intermediate');
    expect(levelFor(10, 65)).toBe('intermediate');
    expect(levelFor(10, 70)).toBe('advanced');
    expect(levelFor(20, 79)).toBe('advanced');
    expect(levelFor(20, 80)).toBe('expert');
  });
});

describe('tutor skills: advanced level and several evidence links', () => {
  it('accepts advanced and a list of https links, rejects bad links', async () => {
    const tutor = await verifiedTutor();
    const skill = await aSkill();
    const bad = await request(app).post('/api/skills/mine').set(auth(tutor.token)).send({ skill_id: skill.id, proficiency: 'advanced', evidence_urls: ['ftp://nope'] });
    expect(bad.status).toBe(400);
    const badLevel = await request(app).post('/api/skills/mine').set(auth(tutor.token)).send({ skill_id: skill.id, proficiency: 'godlike' });
    expect(badLevel.status).toBe(400);
    const ok = await request(app).post('/api/skills/mine').set(auth(tutor.token))
      .send({ skill_id: skill.id, proficiency: 'advanced', evidence_urls: ['https://cert.example/1', 'https://portfolio.example'] });
    expect(ok.status).toBe(201);
    const mine = await request(app).get('/api/skills/mine').set(auth(tutor.token));
    expect(mine.body.tutor_skills[0]).toMatchObject({ proficiency: 'advanced', evidence_urls: ['https://cert.example/1', 'https://portfolio.example'], evidence_url: 'https://cert.example/1' });
  });
});
