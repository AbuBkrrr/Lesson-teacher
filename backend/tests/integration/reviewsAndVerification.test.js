const request = require('supertest');
const { getApp, signupTutor, signupParent, createSuperAdmin, verifyUser } = require('../helpers');

const app = getApp();

async function loginAs(email, password) {
  const res = await request(app).post('/api/auth/login').send({ identifier: email, password });
  return res.body.access_token;
}

async function setupTutorWithRate(email, rate = 5000) {
  const { res } = await signupTutor(app, { email });
  const token = res.body.access_token;
  await verifyUser(res.body.user.id);
  await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${token}`).send({ hourly_rate: rate, currency: 'NGN', subjects: [] });
  return { id: res.body.user.id, token };
}

async function completedPaidBooking(parentToken, tutor) {
  const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutor.id });
  const bookingId = booking.body.booking.id;
  await request(app).patch(`/api/bookings/${bookingId}/status`).set('Authorization', `Bearer ${tutor.token}`).send({ status: 'confirmed' });
  const init = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: bookingId });
  await request(app).post('/api/payments/mock/complete').set('Authorization', `Bearer ${parentToken}`).send({ reference: init.body.reference });
  await request(app).patch(`/api/bookings/${bookingId}/status`).set('Authorization', `Bearer ${tutor.token}`).send({ status: 'completed' });
  return bookingId;
}

describe('reviews and platform-verified badge', () => {
  it('a parent can review a completed booking exactly once, and the tutor rating/review_count update', async () => {
    const tutor = await setupTutorWithRate('reviewtutor@example.com');
    const { res: parentRes } = await signupParent(app, { email: 'reviewparent@example.com' });
    const parentToken = parentRes.body.access_token;
    await verifyUser(parentRes.body.user.id);

    const bookingId = await completedPaidBooking(parentToken, tutor);

    const review = await request(app).post('/api/reviews').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: bookingId, rating: 5, comment: 'Great session' });
    expect(review.status).toBe(201);

    const again = await request(app).post('/api/reviews').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: bookingId, rating: 4 });
    expect(again.status).toBe(400);

    const list = await request(app).get(`/api/reviews/tutor/${tutor.id}`);
    expect(list.body.reviews.length).toBe(1);
    expect(list.body.reviews[0].rating).toBe(5);

    const tutors = await request(app).get('/api/tutors').set('Authorization', `Bearer ${parentToken}`);
    const found = tutors.body.tutors.find((t) => t.user_id === tutor.id);
    expect(found.rating).toBe(5);
    expect(found.review_count).toBe(1);
  });

  it('rejects a review for a booking that is not completed', async () => {
    const tutor = await setupTutorWithRate('reviewtutor2@example.com');
    const { res: parentRes } = await signupParent(app, { email: 'reviewparent2@example.com' });
    const parentToken = parentRes.body.access_token;
    await verifyUser(parentRes.body.user.id);

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutor.id });
    const res = await request(app).post('/api/reviews').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: booking.body.booking.id, rating: 5 });
    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range rating', async () => {
    const tutor = await setupTutorWithRate('reviewtutor3@example.com');
    const { res: parentRes } = await signupParent(app, { email: 'reviewparent3@example.com' });
    const parentToken = parentRes.body.access_token;
    await verifyUser(parentRes.body.user.id);
    const bookingId = await completedPaidBooking(parentToken, tutor);

    const res = await request(app).post('/api/reviews').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: bookingId, rating: 7 });
    expect(res.status).toBe(400);
  });

  it('only super_admin can set the platform-verified flag, and it is never surfaced as a license/certification', async () => {
    const tutor = await setupTutorWithRate('verifytutor@example.com');
    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);

    const denied = await request(app).post(`/api/reviews/tutors/${tutor.id}/verify`).set('Authorization', `Bearer ${tutor.token}`).send({ verified: true });
    expect(denied.status).toBe(403);

    const ok = await request(app).post(`/api/reviews/tutors/${tutor.id}/verify`).set('Authorization', `Bearer ${adminToken}`).send({ verified: true });
    expect(ok.status).toBe(200);
    expect(ok.body.tutor_profile.platform_verified).toBe(1);
    // The field name itself is deliberately NOT "certified" or "licensed".
    expect(Object.keys(ok.body.tutor_profile)).not.toContain('licensed');
    expect(Object.keys(ok.body.tutor_profile)).not.toContain('certified');
  });
});
