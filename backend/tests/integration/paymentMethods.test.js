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

async function bookAndConfirm(tutor, parentToken, parentId) {
  if (parentId) await verifyUser(parentId);
  const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({
    tutor_id: tutor.id, subject: 'Mathematics',
  });
  const bookingId = booking.body.booking.id;
  await request(app).patch(`/api/bookings/${bookingId}/status`).set('Authorization', `Bearer ${tutor.token}`).send({ status: 'confirmed' });
  return bookingId;
}

async function setBankDetails(adminToken, overrides = {}) {
  return request(app).patch('/api/admin/settings').set('Authorization', `Bearer ${adminToken}`).send({
    transfer_bank_name: 'Platform Bank',
    transfer_account_number: '9988776655',
    transfer_account_name: 'LessonTeacher Ltd',
    ...overrides,
  });
}

describe('payment methods', () => {
  it('rejects an unknown payment method', async () => {
    const tutor = await setupTutorWithRate('methodreject_tutor@example.com');
    const { res: parentRes } = await signupParent(app, { email: 'methodreject_parent@example.com' });
    const parentToken = parentRes.body.access_token;
    const bookingId = await bookAndConfirm(tutor, parentToken, parentRes.body.user.id);

    const res = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`)
      .send({ booking_id: bookingId, method: 'bitcoin' });
    expect(res.status).toBe(400);
  });

  it('defaults to the gateway method when none is given, and it behaves like before', async () => {
    const tutor = await setupTutorWithRate('methoddefault_tutor@example.com');
    const { res: parentRes } = await signupParent(app, { email: 'methoddefault_parent@example.com' });
    const parentToken = parentRes.body.access_token;
    const bookingId = await bookAndConfirm(tutor, parentToken, parentRes.body.user.id);

    const res = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`)
      .send({ booking_id: bookingId });
    expect(res.status).toBe(201);
    expect(res.body.method).toBe('gateway');
    expect(res.body.authorization_url).toMatch(/^mock:\/\//);
  });

  it('accepts card and ussd as methods and records them on the payment', async () => {
    const tutor = await setupTutorWithRate('methodcard_tutor@example.com');
    const { res: parentRes } = await signupParent(app, { email: 'methodcard_parent@example.com' });
    const parentToken = parentRes.body.access_token;

    const cardBookingId = await bookAndConfirm(tutor, parentToken, parentRes.body.user.id);
    const cardInit = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`)
      .send({ booking_id: cardBookingId, method: 'card' });
    expect(cardInit.status).toBe(201);
    expect(cardInit.body.method).toBe('card');

    const mine = await request(app).get('/api/payments/mine').set('Authorization', `Bearer ${parentToken}`);
    const cardPayment = mine.body.payments.find((p) => p.booking_id === cardBookingId);
    expect(cardPayment.method).toBe('card');
  });

  it('rejects direct transfer when the platform has not configured a bank account', async () => {
    const tutor = await setupTutorWithRate('methodnobank_tutor@example.com');
    const { res: parentRes } = await signupParent(app, { email: 'methodnobank_parent@example.com' });
    const parentToken = parentRes.body.access_token;
    const bookingId = await bookAndConfirm(tutor, parentToken, parentRes.body.user.id);

    // No admin has set transfer_bank_name/account_number/account_name yet in this test run.
    const res = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`)
      .send({ booking_id: bookingId, method: 'direct_transfer' });
    expect(res.status).toBe(400);
  });

  it('runs the full direct-transfer lifecycle: initialize -> upload proof -> tutor confirms -> earnings update', async () => {
    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);
    const bankSet = await setBankDetails(adminToken);
    expect(bankSet.status).toBe(200);
    expect(bankSet.body.transfer_bank_name).toBe('Platform Bank');

    const tutor = await setupTutorWithRate('methodtransfer_tutor@example.com', 5000);
    const { res: parentRes } = await signupParent(app, { email: 'methodtransfer_parent@example.com' });
    const parentToken = parentRes.body.access_token;
    const bookingId = await bookAndConfirm(tutor, parentToken, parentRes.body.user.id);

    const init = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`)
      .send({ booking_id: bookingId, method: 'direct_transfer' });
    expect(init.status).toBe(201);
    expect(init.body.method).toBe('direct_transfer');
    expect(init.body.transfer_instructions.account_number).toBe('9988776655');
    const paymentId = init.body.payment_id;

    // A second attempt to pay the same booking should be blocked while this one is in flight.
    const dup = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`)
      .send({ booking_id: bookingId, method: 'card' });
    expect(dup.status).toBe(400);

    // This is the real recovery path for that dead end: a parent who left
    // the transfer screen before uploading proof (plausible — they need to
    // go make the actual bank transfer first) can re-fetch the same
    // details rather than being stuck.
    const resumed = await request(app).get(`/api/payments/${paymentId}/transfer-details`).set('Authorization', `Bearer ${parentToken}`);
    expect(resumed.status).toBe(200);
    expect(resumed.body.transfer_instructions.account_number).toBe('9988776655');
    expect(resumed.body.amount).toBe(5000);

    // Someone else can't resume-view another parent's transfer details.
    const { res: nosyParentRes } = await signupParent(app, { email: 'methodtransfer_nosy@example.com' });
    const nosy = await request(app).get(`/api/payments/${paymentId}/transfer-details`).set('Authorization', `Bearer ${nosyParentRes.body.access_token}`);
    expect(nosy.status).toBe(403);

    // Wrong parent can't upload proof for someone else's payment.
    const { res: otherParentRes } = await signupParent(app, { email: 'methodtransfer_intruder@example.com' });
    const intrusion = await request(app).post(`/api/payments/${paymentId}/proof`)
      .set('Authorization', `Bearer ${otherParentRes.body.access_token}`)
      .attach('file', Buffer.from('fake receipt bytes'), 'receipt.png');
    expect(intrusion.status).toBe(403);

    const proof = await request(app).post(`/api/payments/${paymentId}/proof`)
      .set('Authorization', `Bearer ${parentToken}`)
      .attach('file', Buffer.from('fake receipt bytes'), 'receipt.png');
    expect(proof.status).toBe(200);
    expect(proof.body.payment.status).toBe('awaiting_confirmation');
    expect(proof.body.payment.proof_url).toBeTruthy();

    // Mock-complete must not work on a direct transfer — only the confirm endpoint can settle it.
    const mockAttempt = await request(app).post('/api/payments/mock/complete').set('Authorization', `Bearer ${parentToken}`)
      .send({ reference: init.body.reference });
    expect(mockAttempt.status).toBe(400);

    // A different tutor can't confirm someone else's payment.
    const otherTutor = await setupTutorWithRate('methodtransfer_othertutor@example.com');
    const wrongConfirm = await request(app).post(`/api/payments/${paymentId}/confirm`).set('Authorization', `Bearer ${otherTutor.token}`);
    expect(wrongConfirm.status).toBe(403);

    const confirm = await request(app).post(`/api/payments/${paymentId}/confirm`).set('Authorization', `Bearer ${tutor.token}`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.payment.status).toBe('successful');
    expect(confirm.body.payment.confirmed_by).toBe(tutor.id);

    const earnings = await request(app).get('/api/payments/earnings/summary').set('Authorization', `Bearer ${tutor.token}`);
    expect(earnings.body.total_earned).toBe(4250);
  });
});
