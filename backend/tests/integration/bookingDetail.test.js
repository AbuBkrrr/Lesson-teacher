const request = require('supertest');
const { getApp, signupTutor, signupParent, verifyUser } = require('../helpers');

const app = getApp();

async function setupTutorWithRate(email, rate = 5000) {
  const { res } = await signupTutor(app, { email });
  const token = res.body.access_token;
  await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${token}`).send({ hourly_rate: rate, currency: 'NGN', subjects: [] });
  return { id: res.body.user.id, token };
}

describe('GET /bookings/:id', () => {
  it('returns the booking with joined names to either participant', async () => {
    const tutor = await setupTutorWithRate('bookingdetail_tutor@example.com');
    const { res: parentRes } = await signupParent(app, { email: 'bookingdetail_parent@example.com' });
    const parentToken = parentRes.body.access_token;
    await verifyUser(parentRes.body.user.id);

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`)
      .send({ tutor_id: tutor.id, subject: 'Physics' });
    const bookingId = booking.body.booking.id;

    const asParent = await request(app).get(`/api/bookings/${bookingId}`).set('Authorization', `Bearer ${parentToken}`);
    expect(asParent.status).toBe(200);
    expect(asParent.body.booking.tutor_name).toBeTruthy();
    expect(asParent.body.booking.subject).toBe('Physics');

    const asTutor = await request(app).get(`/api/bookings/${bookingId}`).set('Authorization', `Bearer ${tutor.token}`);
    expect(asTutor.status).toBe(200);
    expect(asTutor.body.booking.parent_name).toBeTruthy();
  });

  it('blocks a user who is not on the booking', async () => {
    const tutor = await setupTutorWithRate('bookingdetail_tutor2@example.com');
    const { res: parentRes } = await signupParent(app, { email: 'bookingdetail_parent2@example.com' });
    await verifyUser(parentRes.body.user.id);
    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .send({ tutor_id: tutor.id, subject: 'Chemistry' });
    const bookingId = booking.body.booking.id;

    const { res: intruderRes } = await signupParent(app, { email: 'bookingdetail_intruder@example.com' });
    const res = await request(app).get(`/api/bookings/${bookingId}`).set('Authorization', `Bearer ${intruderRes.body.access_token}`);
    expect(res.status).toBe(403);
  });

  it('404s for a booking that does not exist', async () => {
    const { res: parentRes } = await signupParent(app, { email: 'bookingdetail_parent3@example.com' });
    const res = await request(app).get('/api/bookings/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${parentRes.body.access_token}`);
    expect(res.status).toBe(404);
  });
});
