const request = require('supertest');
const { getApp, signupTutor, signupParent, verifyUser } = require('../helpers');

const app = getApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function setup() {
  const { res: t } = await signupTutor(app);
  const { res: p } = await signupParent(app);
  await verifyUser(t.body.user.id);
  await verifyUser(p.body.user.id);
  return { tutor: { token: t.body.access_token, id: t.body.user.id }, parent: { token: p.body.access_token, id: p.body.user.id } };
}
const inDays = (d, h = 10) => { const x = new Date(Date.now() + d * 864e5); x.setUTCHours(h, 0, 0, 0); return x; };
const book = (parent, tutor, when) => request(app).post('/api/bookings').set(auth(parent.token)).send({ tutor_id: tutor.id, subject: 'Maths', scheduled_at: when });

describe('lesson scheduling', () => {
  it('normalises times to UTC ISO, treats offset-less input as UTC, and rejects past/invalid times', async () => {
    const { tutor, parent } = await setup();
    const when = inDays(3);
    const naive = when.toISOString().slice(0, 16); // 'YYYY-MM-DDTHH:MM'
    const ok = await book(parent, tutor, naive);
    expect(ok.status).toBe(201);
    expect(ok.body.booking.scheduled_at).toBe(when.toISOString());
    expect((await book(parent, tutor, new Date(Date.now() - 864e5).toISOString())).status).toBe(400);
    expect((await book(parent, tutor, 'not a date')).status).toBe(400);
  });

  it('enforces published availability in the tutor time zone', async () => {
    const { tutor, parent } = await setup();
    await request(app).put('/api/tutors/me').set(auth(tutor.token)).send({ hourly_rate: 1000, currency: 'NGN', subjects: [], timezone: 'Africa/Lagos' });
    const target = inDays(4, 9); // 09:00 UTC == 10:00 Lagos
    const dow = new Date(target.getTime() + 3600e3).getUTCDay();
    await request(app).put('/api/tutors/me/availability').set(auth(tutor.token)).send({ slots: [{ day_of_week: dow, start_time: '10:00', end_time: '12:00' }] });
    expect((await book(parent, tutor, target.toISOString())).status).toBe(201);
    const outside = inDays(4, 15); // 16:00 Lagos
    const res = await book(parent, tutor, outside.toISOString());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/availability/i);
  });

  it('blocks a second confirmed lesson at an overlapping time, and lets participants reschedule', async () => {
    const { tutor, parent } = await setup();
    const when = inDays(5);
    const a = await book(parent, tutor, when.toISOString());
    expect((await request(app).patch(`/api/bookings/${a.body.booking.id}/status`).set(auth(tutor.token)).send({ status: 'confirmed' })).status).toBe(200);
    // Overlapping request is refused up front.
    expect((await book(parent, tutor, new Date(when.getTime() + 30 * 60000).toISOString())).status).toBe(409);
    // Reschedule the confirmed lesson (parent), and the ics reflects it.
    const later = inDays(6, 11);
    const r = await request(app).patch(`/api/bookings/${a.body.booking.id}/schedule`).set(auth(parent.token)).send({ scheduled_at: later.toISOString() });
    expect(r.status).toBe(200);
    expect(r.body.booking.scheduled_at).toBe(later.toISOString());
    const ics = await request(app).get(`/api/bookings/${a.body.booking.id}/ics`).set(auth(tutor.token));
    expect(ics.status).toBe(200);
    expect(ics.text).toContain('BEGIN:VEVENT');
    expect(ics.text).toContain(later.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''));
    // A stranger can't reschedule or download it.
    const { parent: stranger } = await setup();
    expect((await request(app).patch(`/api/bookings/${a.body.booking.id}/schedule`).set(auth(stranger.token)).send({ scheduled_at: later.toISOString() })).status).toBe(403);
    expect((await request(app).get(`/api/bookings/${a.body.booking.id}/ics`).set(auth(stranger.token))).status).toBe(403);
  });

  it('lets a booking without a time get one, and rejects overlapping availability slots and bad time zones', async () => {
    const { tutor, parent } = await setup();
    const b = await request(app).post('/api/bookings').set(auth(parent.token)).send({ tutor_id: tutor.id, subject: 'Maths' });
    expect((await request(app).get(`/api/bookings/${b.body.booking.id}/ics`).set(auth(parent.token))).status).toBe(400);
    expect((await request(app).patch(`/api/bookings/${b.body.booking.id}/schedule`).set(auth(tutor.token)).send({ scheduled_at: inDays(2).toISOString() })).status).toBe(200);
    const overlap = await request(app).put('/api/tutors/me/availability').set(auth(tutor.token)).send({ slots: [
      { day_of_week: 1, start_time: '09:00', end_time: '11:00' }, { day_of_week: 1, start_time: '10:00', end_time: '12:00' }] });
    expect(overlap.status).toBe(400);
    const tz = await request(app).put('/api/tutors/me').set(auth(tutor.token)).send({ subjects: [], timezone: 'Mars/Phobos' });
    expect(tz.status).toBe(400);
  });
});
