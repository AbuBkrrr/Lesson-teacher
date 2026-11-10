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
  await request(app).put('/api/tutors/me/bank-account').set('Authorization', `Bearer ${token}`).send({
    bank_name: 'Test Bank', bank_code: '058', account_number: '0123456789', account_name: 'Test Tutor',
  });
  return { id: res.body.user.id, token };
}

describe('bookings, payments, and payouts', () => {
  it('runs the full lifecycle: book -> confirm -> pay -> complete -> payout', async () => {
    const tutor = await setupTutorWithRate('lifecycletutor@example.com', 5000);
    const { res: parentRes } = await signupParent(app, { email: 'lifecycleparent@example.com' });
    const parentToken = parentRes.body.access_token;
    await verifyUser(parentRes.body.user.id);

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({
      tutor_id: tutor.id, subject: 'Mathematics',
    });
    expect(booking.status).toBe(201);
    expect(booking.body.booking.status).toBe('pending');
    const bookingId = booking.body.booking.id;

    const confirm = await request(app).patch(`/api/bookings/${bookingId}/status`).set('Authorization', `Bearer ${tutor.token}`).send({ status: 'confirmed' });
    expect(confirm.status).toBe(200);

    const tooEarly = await request(app).patch(`/api/bookings/${bookingId}/status`).set('Authorization', `Bearer ${tutor.token}`).send({ status: 'completed' });
    expect(tooEarly.status).toBe(400);

    const init = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: bookingId });
    expect(init.status).toBe(201);
    expect(init.body.amount).toBe(5000);

    const complete = await request(app).post('/api/payments/mock/complete').set('Authorization', `Bearer ${parentToken}`).send({ reference: init.body.reference });
    expect(complete.status).toBe(200);
    expect(complete.body.payment.status).toBe('successful');

    const nowComplete = await request(app).patch(`/api/bookings/${bookingId}/status`).set('Authorization', `Bearer ${tutor.token}`).send({ status: 'completed' });
    expect(nowComplete.status).toBe(200);

    const earnings = await request(app).get('/api/payments/earnings/summary').set('Authorization', `Bearer ${tutor.token}`);
    expect(earnings.body.total_earned).toBe(4250);
    expect(earnings.body.pending_payout).toBe(4250);

    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);

    const balances = await request(app).get('/api/admin/payouts/balances').set('Authorization', `Bearer ${adminToken}`);
    expect(balances.body.balances.some((b) => b.tutor_id === tutor.id && b.owed === 4250)).toBe(true);

    const payout = await request(app).post(`/api/admin/payouts/tutor/${tutor.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(payout.status).toBe(201);
    expect(payout.body.payout.amount).toBe(4250);

    const earningsAfter = await request(app).get('/api/payments/earnings/summary').set('Authorization', `Bearer ${tutor.token}`);
    expect(earningsAfter.body.pending_payout).toBe(0);
    expect(earningsAfter.body.already_paid_out).toBe(4250);
  });

  it('rejects payment for a booking that is not yet confirmed', async () => {
    const tutor = await setupTutorWithRate('unconfirmed@example.com');
    const { res: parentRes } = await signupParent(app, { email: 'unconfirmedparent@example.com' });
    const parentToken = parentRes.body.access_token;
    await verifyUser(parentRes.body.user.id);

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutor.id });
    const res = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: booking.body.booking.id });
    expect(res.status).toBe(400);
  });

  it('rejects a payout when the tutor has no bank account on file', async () => {
    const { res: tutorRes } = await signupTutor(app, { email: 'nobank@example.com' });
    await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${tutorRes.body.access_token}`).send({ hourly_rate: 3000, currency: 'NGN', subjects: [] });

    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);
    const res = await request(app).post(`/api/admin/payouts/tutor/${tutorRes.body.user.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('only the owning tutor or parent can update a booking status', async () => {
    const tutor = await setupTutorWithRate('ownership@example.com');
    const { res: parentRes } = await signupParent(app, { email: 'ownershipparent@example.com' });
    const { res: strangerRes } = await signupParent(app, { email: 'stranger@example.com' });
    await verifyUser(parentRes.body.user.id);

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentRes.body.access_token}`).send({ tutor_id: tutor.id });
    const res = await request(app)
      .patch(`/api/bookings/${booking.body.booking.id}/status`)
      .set('Authorization', `Bearer ${strangerRes.body.access_token}`)
      .send({ status: 'cancelled' });
    expect(res.status).toBe(403);
  });

  it('payments/mine never leaks every payment platform-wide to a role it was not scoped for (regression)', async () => {
    const tutor = await setupTutorWithRate('payleakcheck@example.com', 5000);
    const { res: parentRes } = await signupParent(app, { email: 'payleakcheckparent@example.com' });
    await verifyUser(parentRes.body.user.id);
    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentRes.body.access_token}`).send({ tutor_id: tutor.id });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutor.token}`).send({ status: 'confirmed' });
    await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentRes.body.access_token}`).send({ booking_id: booking.body.booking.id });

    const schoolSignup = await request(app)
      .post('/api/auth/signup')
      .send({ role: 'school_admin', full_name: 'Pay Leak School', email: 'payleakschool@example.com', password: 'TestPass123', school_name: 'Pay Leak School' });
    const res = await request(app).get('/api/payments/mine').set('Authorization', `Bearer ${schoolSignup.body.access_token}`);
    expect(res.status).toBe(403);
  });

  it('bookings/mine never leaks every booking platform-wide to a role it was not scoped for (regression: was falling through to an unscoped SELECT *)', async () => {
    // Two unrelated bookings that a child/other role must never see via /mine
    await setupTutorWithRate('leakcheck1@example.com');
    const other = await setupTutorWithRate('leakcheck2@example.com');
    const { res: someParent } = await signupParent(app, { email: 'leakcheckparent@example.com' });
    await verifyUser(someParent.body.user.id);
    await request(app).post('/api/bookings').set('Authorization', `Bearer ${someParent.body.access_token}`).send({ tutor_id: other.id });

    // A school_admin has no bookings of their own and must get an explicit
    // rejection, not the platform's entire booking list.
    const schoolSignup = await request(app)
      .post('/api/auth/signup')
      .send({ role: 'school_admin', full_name: 'Leak Check School', email: 'leakcheckschool@example.com', password: 'TestPass123', school_name: 'Leak Check School' });
    const res = await request(app).get('/api/bookings/mine').set('Authorization', `Bearer ${schoolSignup.body.access_token}`);
    expect(res.status).toBe(403);
  });
});
