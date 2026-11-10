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

describe('sibling / family-plan discount', () => {
  it('applies no discount for a parent with only one child', async () => {
    const tutor = await setupTutorWithRate('sibtutor1@example.com');
    const { res: parentRes } = await signupParent(app, { email: 'sibparent1@example.com' });
    const parentToken = parentRes.body.access_token;
    await verifyUser(parentRes.body.user.id);
    await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`).send({ full_name: 'Only Child' });

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutor.id });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutor.token}`).send({ status: 'confirmed' });

    const init = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: booking.body.booking.id });
    expect(init.body.sibling_discount_percent).toBe(0);
    expect(init.body.amount).toBe(5000);
  });

  it('applies the configured discount for a parent with 2+ children', async () => {
    const tutor = await setupTutorWithRate('sibtutor2@example.com');
    const { res: parentRes } = await signupParent(app, { email: 'sibparent2@example.com' });
    const parentToken = parentRes.body.access_token;
    await verifyUser(parentRes.body.user.id);
    await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`).send({ full_name: 'Kid A' });
    await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`).send({ full_name: 'Kid B' });

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutor.id });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutor.token}`).send({ status: 'confirmed' });

    const init = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: booking.body.booking.id });
    expect(init.body.sibling_discount_percent).toBe(10); // default from settings
    expect(init.body.amount).toBe(4500); // 5000 * 0.9
  });
});

describe('satisfaction guarantee (refund / reschedule requests)', () => {
  async function completedPaidBooking(parentToken, tutor) {
    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutor.id });
    const bookingId = booking.body.booking.id;
    await request(app).patch(`/api/bookings/${bookingId}/status`).set('Authorization', `Bearer ${tutor.token}`).send({ status: 'confirmed' });
    const init = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: bookingId });
    await request(app).post('/api/payments/mock/complete').set('Authorization', `Bearer ${parentToken}`).send({ reference: init.body.reference });
    await request(app).patch(`/api/bookings/${bookingId}/status`).set('Authorization', `Bearer ${tutor.token}`).send({ status: 'completed' });
    return bookingId;
  }

  it('lets a parent request a refund within the guarantee window, and an admin can approve + complete it', async () => {
    const tutor = await setupTutorWithRate('refundtutor1@example.com');
    const { res: parentRes } = await signupParent(app, { email: 'refundparent1@example.com' });
    const parentToken = parentRes.body.access_token;
    await verifyUser(parentRes.body.user.id);
    const bookingId = await completedPaidBooking(parentToken, tutor);

    const req1 = await request(app).post('/api/refund-requests').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: bookingId, resolution: 'refund', reason: 'Not satisfied' });
    expect(req1.status).toBe(201);
    expect(req1.body.refund_request.status).toBe('pending');

    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);

    const approve = await request(app).patch(`/api/refund-requests/${req1.body.refund_request.id}/resolve`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'approved' });
    expect(approve.status).toBe(200);

    const complete = await request(app).patch(`/api/refund-requests/${req1.body.refund_request.id}/resolve`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'completed' });
    expect(complete.status).toBe(200);

    const payments = await request(app).get('/api/payments/mine').set('Authorization', `Bearer ${parentToken}`);
    expect(payments.body.payments.find((p) => p.booking_id === bookingId).status).toBe('refunded');
  });

  it('rejects a second request for the same booking while one is already pending', async () => {
    const tutor = await setupTutorWithRate('refundtutor2@example.com');
    const { res: parentRes } = await signupParent(app, { email: 'refundparent2@example.com' });
    const parentToken = parentRes.body.access_token;
    await verifyUser(parentRes.body.user.id);
    const bookingId = await completedPaidBooking(parentToken, tutor);

    await request(app).post('/api/refund-requests').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: bookingId, reason: 'first' });
    const second = await request(app).post('/api/refund-requests').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: bookingId, reason: 'second' });
    expect(second.status).toBe(400);
  });

  it('only super_admin can resolve a refund request', async () => {
    const tutor = await setupTutorWithRate('refundtutor3@example.com');
    const { res: parentRes } = await signupParent(app, { email: 'refundparent3@example.com' });
    const parentToken = parentRes.body.access_token;
    await verifyUser(parentRes.body.user.id);
    const bookingId = await completedPaidBooking(parentToken, tutor);

    const created = await request(app).post('/api/refund-requests').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: bookingId, reason: 'test' });
    const res = await request(app).patch(`/api/refund-requests/${created.body.refund_request.id}/resolve`).set('Authorization', `Bearer ${tutor.token}`).send({ status: 'approved' });
    expect(res.status).toBe(403);
  });
});
