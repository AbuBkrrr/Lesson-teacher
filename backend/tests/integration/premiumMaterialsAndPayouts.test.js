const request = require('supertest');
const { getApp, signupTutor, signupParent, verifyUser } = require('../helpers');

const app = getApp();

async function setupConfirmedBooking(parentEmail, tutorEmail, rate = 5000) {
  const { res: tutorRes } = await signupTutor(app, { email: tutorEmail });
  const tutorToken = tutorRes.body.access_token;
  const tutorId = tutorRes.body.user.id;
  await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${tutorToken}`).send({ hourly_rate: rate, currency: 'NGN', subjects: [] });
  await request(app).put('/api/tutors/me/bank-account').set('Authorization', `Bearer ${tutorToken}`).send({
    bank_name: 'Test Bank', bank_code: '058', account_number: '0123456789', account_name: 'Test Tutor',
  });

  const { res: parentRes } = await signupParent(app, { email: parentEmail });
  const parentToken = parentRes.body.access_token;
  await verifyUser(tutorId);
  await verifyUser(parentRes.body.user.id);

  const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorId });
  await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutorToken}`).send({ status: 'confirmed' });

  return { tutorToken, tutorId, parentToken, bookingId: booking.body.booking.id };
}

describe('premium content packs', () => {
  it("a parent without a confirmed booking can't see a premium material's file, only a locked preview", async () => {
    const { res: tutorRes } = await signupTutor(app, { email: 'premiumtutor1@example.com' });
    const tutorToken = tutorRes.body.access_token;
    await verifyUser(tutorRes.body.user.id);
    const upload = await request(app).post('/api/lesson-materials').set('Authorization', `Bearer ${tutorToken}`)
      .field('title', 'Premium Pack').field('is_premium', 'true').field('price', '1500').attach('file', Buffer.from('x'), 'x.pdf');
    expect(upload.status).toBe(201);
    expect(upload.body.material.is_premium).toBe(1);

    const { res: parentRes } = await signupParent(app, { email: 'premiumparent1@example.com' });
    await verifyUser(parentRes.body.user.id);
    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentRes.body.access_token}`).send({ tutor_id: tutorRes.body.user.id });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutorToken}`).send({ status: 'confirmed' });

    const list = await request(app).get(`/api/lesson-materials/tutor/${tutorRes.body.user.id}`).set('Authorization', `Bearer ${parentRes.body.access_token}`);
    expect(list.body.materials[0].locked).toBe(true);
    expect(list.body.materials[0].file_url).toBeNull();
  });

  it('after purchase, the file_url is unlocked for that parent', async () => {
    const { res: tutorRes } = await signupTutor(app, { email: 'premiumtutor2@example.com' });
    const tutorToken = tutorRes.body.access_token;
    await verifyUser(tutorRes.body.user.id);
    const upload = await request(app).post('/api/lesson-materials').set('Authorization', `Bearer ${tutorToken}`)
      .field('title', 'Premium Pack 2').field('is_premium', 'true').field('price', '1500').attach('file', Buffer.from('x'), 'x.pdf');
    const materialId = upload.body.material.id;

    const { res: parentRes } = await signupParent(app, { email: 'premiumparent2@example.com' });
    const parentToken = parentRes.body.access_token;
    await verifyUser(parentRes.body.user.id);
    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorRes.body.user.id });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutorToken}`).send({ status: 'confirmed' });

    const purchase = await request(app).post(`/api/lesson-materials/${materialId}/purchase`).set('Authorization', `Bearer ${parentToken}`);
    expect(purchase.status).toBe(201);
    expect(purchase.body.purchased).toBe(true);

    const list = await request(app).get(`/api/lesson-materials/tutor/${tutorRes.body.user.id}`).set('Authorization', `Bearer ${parentToken}`);
    expect(list.body.materials[0].file_url).toMatch(/^http/);
  });

  it('rejects a duplicate purchase', async () => {
    const { res: tutorRes } = await signupTutor(app, { email: 'premiumtutor3@example.com' });
    const upload = await request(app).post('/api/lesson-materials').set('Authorization', `Bearer ${tutorRes.body.access_token}`)
      .field('title', 'Premium Pack 3').field('is_premium', 'true').field('price', '1500').attach('file', Buffer.from('x'), 'x.pdf');

    const { res: parentRes } = await signupParent(app, { email: 'premiumparent3@example.com' });
    const parentToken = parentRes.body.access_token;
    await request(app).post(`/api/lesson-materials/${upload.body.material.id}/purchase`).set('Authorization', `Bearer ${parentToken}`);
    const again = await request(app).post(`/api/lesson-materials/${upload.body.material.id}/purchase`).set('Authorization', `Bearer ${parentToken}`);
    expect(again.status).toBe(400);
  });
});

describe('fast/flexible (instant) tutor payouts', () => {
  it('a tutor can self-serve an instant payout, minus the configured fee', async () => {
    const { tutorToken, tutorId, parentToken, bookingId } = await setupConfirmedBooking('instanttutor1@example.com', 'instantparent1@example.com', 5000);
    const init = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: bookingId });
    await request(app).post('/api/payments/mock/complete').set('Authorization', `Bearer ${parentToken}`).send({ reference: init.body.reference });
    await request(app).patch(`/api/bookings/${bookingId}/status`).set('Authorization', `Bearer ${tutorToken}`).send({ status: 'completed' });

    // Gross owed to the tutor: 5000 - 15% commission = 4250. Instant fee defaults to 2%.
    const payout = await request(app).post('/api/payouts/instant').set('Authorization', `Bearer ${tutorToken}`);
    expect(payout.status).toBe(201);
    expect(payout.body.gross_amount).toBe(4250);
    expect(payout.body.fee).toBeCloseTo(85, 2); // 2% of 4250
    expect(payout.body.payout.amount).toBeCloseTo(4165, 2);
    expect(payout.body.payout.speed).toBe('instant');
  });

  it('two simultaneous payout requests pay the earnings only once', async () => {
    const { tutorToken, parentToken, bookingId } = await setupConfirmedBooking('racetutor1@example.com', 'raceparent1@example.com', 5000);
    const init = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: bookingId });
    await request(app).post('/api/payments/mock/complete').set('Authorization', `Bearer ${parentToken}`).send({ reference: init.body.reference });
    await request(app).patch(`/api/bookings/${bookingId}/status`).set('Authorization', `Bearer ${tutorToken}`).send({ status: 'completed' });

    const [a, b] = await Promise.all([
      request(app).post('/api/payouts/instant').set('Authorization', `Bearer ${tutorToken}`),
      request(app).post('/api/payouts/instant').set('Authorization', `Bearer ${tutorToken}`),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    const mine = await request(app).get('/api/payouts/mine').set('Authorization', `Bearer ${tutorToken}`);
    expect(mine.body.payouts).toHaveLength(1);
  });

  it('rejects an instant payout with nothing owed', async () => {
    const { res: tutorRes } = await signupTutor(app, { email: 'instanttutor2@example.com' });
    await verifyUser(tutorRes.body.user.id);
    await request(app).put('/api/tutors/me/bank-account').set('Authorization', `Bearer ${tutorRes.body.access_token}`).send({
      bank_code: '058', account_number: '0123456789', account_name: 'Test Tutor',
    });
    const res = await request(app).post('/api/payouts/instant').set('Authorization', `Bearer ${tutorRes.body.access_token}`);
    expect(res.status).toBe(400);
  });

  it('only tutors can request an instant payout', async () => {
    const { res: parentRes } = await signupParent(app, { email: 'instantparent2@example.com' });
    const res = await request(app).post('/api/payouts/instant').set('Authorization', `Bearer ${parentRes.body.access_token}`);
    expect(res.status).toBe(403);
  });
});

describe('AI-assisted tutor matching', () => {
  it('returns a scored, explainable ranking for a given skill', async () => {
    const admin = require('../helpers').createSuperAdmin;
    const adminInfo = await admin();
    const loginRes = await request(app).post('/api/auth/login').send({ identifier: adminInfo.email, password: adminInfo.password });
    const adminToken = loginRes.body.access_token;

    const skill = await request(app).post('/api/skills').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Matching Subject', category: 'academic' });

    const { res: tutorRes } = await signupTutor(app, { email: 'matchtutor1@example.com' });
    await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${tutorRes.body.access_token}`).send({ hourly_rate: 4000, currency: 'NGN', subjects: [] });
    await request(app).post('/api/skills/mine').set('Authorization', `Bearer ${tutorRes.body.access_token}`).send({ skill_id: skill.body.skill.id });

    const { res: parentRes } = await signupParent(app, { email: 'matchparent1@example.com' });
    const res = await request(app).get(`/api/tutors/recommended?skill_id=${skill.body.skill.id}`).set('Authorization', `Bearer ${parentRes.body.access_token}`);
    expect(res.status).toBe(200);
    expect(res.body.recommended_tutors.some((t) => t.tutor_id === tutorRes.body.user.id)).toBe(true);
    expect(res.body.recommended_tutors[0].score_breakdown).toBeDefined();
    expect(res.body.note).toMatch(/not a clinical/);
  });
});
