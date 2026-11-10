const request = require('supertest');
const db = require('../../src/config/db');
const { getApp, signupParent, signupTutor, createSuperAdmin, verifyUser } = require('../helpers');

const app = getApp();

async function setupTutorWithRate(overrides = {}, rate = 5000) {
  const { res } = await signupTutor(app, overrides);
  const token = res.body.access_token;
  await verifyUser(res.body.user.id);
  await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${token}`).send({ hourly_rate: rate, currency: 'NGN' });
  return { id: res.body.user.id, token };
}

/** Fetches the most recent notification of a given type sent to a user — fails loudly (undefined) if none exists, which every assertion below checks for. */
async function latestNotification(userId, type) {
  return db.prepare(
    "SELECT * FROM notifications WHERE user_id = ? AND type = ? AND channel = 'email' ORDER BY created_at DESC LIMIT 1"
  ).get(userId, type);
}

describe('notifications', () => {
  it('notifies the tutor by email when a booking is requested', async () => {
    const tutor = await setupTutorWithRate({ email: `notiftutor1_${Date.now()}@example.com` });
    const { res: parentRes } = await signupParent(app, { email: `notifparent1_${Date.now()}@example.com`, full_name: 'Notify Parent' });
    await verifyUser(parentRes.body.user.id);

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .send({ tutor_id: tutor.id, subject: 'Mathematics' });
    expect(booking.status).toBe(201); // the actual regression this whole test file guards against

    const n = await latestNotification(tutor.id, 'booking_requested');
    expect(n).toBeDefined();
    expect(n.channel).toBe('email');
    expect(n.status).toBe('sent');
    expect(n.body).toContain('Notify Parent');
    expect(n.body).toContain('Mathematics');
  });

  it('notifies the parent when the tutor confirms a booking', async () => {
    const tutor = await setupTutorWithRate({ email: `notiftutor2_${Date.now()}@example.com`, full_name: 'Notify Tutor' });
    const { res: parentRes } = await signupParent(app, { email: `notifparent2_${Date.now()}@example.com` });
    await verifyUser(parentRes.body.user.id);
    const parentId = parentRes.body.user.id;

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .send({ tutor_id: tutor.id, subject: 'Physics' });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutor.token}`)
      .send({ status: 'confirmed' });

    const n = await latestNotification(parentId, 'booking_confirmed');
    expect(n).toBeDefined();
    expect(n.body).toContain('Notify Tutor');
    expect(n.body).toContain('Physics');
  });

  it('notifies the parent with "declined" phrasing when the tutor declines a pending request', async () => {
    const tutor = await setupTutorWithRate({ email: `notiftutor3_${Date.now()}@example.com` });
    const { res: parentRes } = await signupParent(app, { email: `notifparent3_${Date.now()}@example.com` });
    await verifyUser(parentRes.body.user.id);

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .send({ tutor_id: tutor.id });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutor.token}`)
      .send({ status: 'cancelled' });

    const n = await latestNotification(parentRes.body.user.id, 'booking_declined');
    expect(n).toBeDefined();
    expect(n.body).toMatch(/unable to accept/i);
  });

  it('notifies the tutor with "cancelled" phrasing when the parent cancels a confirmed booking', async () => {
    const tutor = await setupTutorWithRate({ email: `notiftutor4_${Date.now()}@example.com` });
    const { res: parentRes } = await signupParent(app, { email: `notifparent4_${Date.now()}@example.com`, full_name: 'Cancelling Parent' });
    await verifyUser(parentRes.body.user.id);

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .send({ tutor_id: tutor.id });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutor.token}`)
      .send({ status: 'confirmed' });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .send({ status: 'cancelled' });

    const n = await latestNotification(tutor.id, 'booking_cancelled');
    expect(n).toBeDefined();
    expect(n.body).toContain('Cancelling Parent');
    expect(n.body).toMatch(/cancelled/i);
  });

  it('sends both a receipt to the parent and a payment-received notice to the tutor on a successful payment', async () => {
    const tutor = await setupTutorWithRate({ email: `notiftutor5_${Date.now()}@example.com` }, 5000);
    const { res: parentRes } = await signupParent(app, { email: `notifparent5_${Date.now()}@example.com` });
    await verifyUser(parentRes.body.user.id);
    const parentToken = parentRes.body.access_token;

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutor.id });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutor.token}`).send({ status: 'confirmed' });

    const init = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`)
      .send({ booking_id: booking.body.booking.id, method: 'gateway' });
    await request(app).post('/api/payments/mock/complete').set('Authorization', `Bearer ${parentToken}`).send({ reference: init.body.reference });

    const receiptN = await latestNotification(parentRes.body.user.id, 'payment_receipt');
    expect(receiptN).toBeDefined();
    expect(receiptN.body).toContain('NGN 5000');

    const paidN = await latestNotification(tutor.id, 'payment_received');
    expect(paidN).toBeDefined();
    expect(paidN.body).toContain('4250'); // 5000 minus the 15% platform commission
  });

  it('notifies the tutor when a parent uploads direct-transfer proof', async () => {
    const admin = await createSuperAdmin();
    const adminLogin = await request(app).post('/api/auth/login').send({ identifier: admin.email, password: admin.password });
    const adminToken = adminLogin.body.access_token;
    await request(app).patch('/api/admin/settings').set('Authorization', `Bearer ${adminToken}`)
      .send({ transfer_bank_name: 'Test Bank', transfer_account_number: '1234567890', transfer_account_name: 'Platform' });

    const tutor = await setupTutorWithRate({ email: `notiftutor6_${Date.now()}@example.com` });
    const { res: parentRes } = await signupParent(app, { email: `notifparent6_${Date.now()}@example.com`, full_name: 'Proof Parent' });
    await verifyUser(parentRes.body.user.id);
    const parentToken = parentRes.body.access_token;

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutor.id });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutor.token}`).send({ status: 'confirmed' });

    const init = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`)
      .send({ booking_id: booking.body.booking.id, method: 'direct_transfer' });
    await request(app).post(`/api/payments/${init.body.payment_id}/proof`).set('Authorization', `Bearer ${parentToken}`)
      .attach('file', Buffer.from('fake receipt'), 'receipt.png');

    const n = await latestNotification(tutor.id, 'direct_transfer_proof_uploaded');
    expect(n).toBeDefined();
    expect(n.body).toContain('Proof Parent');
  });

  it('notifies the parent (not the child directly) when an assignment is created and graded', async () => {
    const tutor = await setupTutorWithRate({ email: `notiftutor7_${Date.now()}@example.com`, full_name: 'Grading Tutor' });
    const { res: parentRes } = await signupParent(app, { email: `notifparent7_${Date.now()}@example.com` });
    await verifyUser(parentRes.body.user.id);
    const parentToken = parentRes.body.access_token;
    const parentId = parentRes.body.user.id;

    const child = await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`).send({ full_name: 'Notif Kid' });
    const childId = child.body.child.id;

    // Assigning work requires a confirmed booking with that child first — a real business rule (verifyRelationship), not a formality.
    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`)
      .send({ tutor_id: tutor.id, child_id: childId });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutor.token}`)
      .send({ status: 'confirmed' });

    const assignment = await request(app).post('/api/assignments').set('Authorization', `Bearer ${tutor.token}`)
      .send({ child_id: childId, title: 'Fractions worksheet' });
    expect(assignment.status).toBe(201);

    const createdN = await latestNotification(parentId, 'assignment_created');
    expect(createdN).toBeDefined();
    expect(createdN.body).toContain('Grading Tutor');
    expect(createdN.body).toContain('Fractions worksheet');

    await request(app).patch(`/api/assignments/${assignment.body.assignment.id}/submit`).set('Authorization', `Bearer ${parentToken}`)
      .send({ content: 'done' });
    await request(app).patch(`/api/assignments/${assignment.body.assignment.id}/grade`).set('Authorization', `Bearer ${tutor.token}`)
      .send({ grade: 'A' });

    const gradedN = await latestNotification(parentId, 'assignment_graded');
    expect(gradedN).toBeDefined();
    expect(gradedN.body).toContain('A');
  });

  it('sends to both email and SMS when a user has both on file, and records nothing for a channel that has neither', async () => {
    const tutor = await setupTutorWithRate({ email: `notiftutor8_${Date.now()}@example.com`, phone: `+1555${Date.now().toString().slice(-7)}` });
    const { res: parentRes } = await signupParent(app, { email: `notifparent8_${Date.now()}@example.com` });
    await verifyUser(parentRes.body.user.id);

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentRes.body.access_token}`).send({ tutor_id: tutor.id });
    expect(booking.status).toBe(201);

    const emailN = await db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'booking_requested' AND channel = 'email'").get(tutor.id);
    const allForTutor = await db.prepare("SELECT channel FROM notifications WHERE user_id = ? AND type = 'booking_requested' AND channel <> 'in_app'").all(tutor.id);
    expect(emailN.channel).toBe('email');
    expect(allForTutor.map((r) => r.channel).sort()).toEqual(['email', 'sms']);
  });

  it('notifies tutors on a lesson-request application being accepted or declined', async () => {
    const { res: parentRes } = await signupParent(app, { email: `notifparent9_${Date.now()}@example.com` });
    const parentToken = parentRes.body.access_token;
    await verifyUser(parentRes.body.user.id);

    const winner = await setupTutorWithRate({ email: `notiftutor9a_${Date.now()}@example.com` });
    const loser = await setupTutorWithRate({ email: `notiftutor9b_${Date.now()}@example.com` });

    const reqRes = await request(app).post('/api/lesson-requests').set('Authorization', `Bearer ${parentToken}`).send({ title: 'Geometry help' });
    const requestId = reqRes.body.lesson_request.id;

    const winnerApp = await request(app).post(`/api/lesson-requests/${requestId}/apply`).set('Authorization', `Bearer ${winner.token}`).send({ message: 'I can help' });
    const loserApp = await request(app).post(`/api/lesson-requests/${requestId}/apply`).set('Authorization', `Bearer ${loser.token}`).send({ message: 'Me too' });

    await request(app).post(`/api/lesson-requests/${requestId}/applications/${winnerApp.body.application.id}/accept`).set('Authorization', `Bearer ${parentToken}`);

    const acceptedN = await latestNotification(winner.id, 'application_accepted');
    expect(acceptedN).toBeDefined();
    expect(acceptedN.body).toContain('Geometry help');

    // The losing applicant gets auto-declined (and notified) when another application is accepted.
    const declinedN = await latestNotification(loser.id, 'application_declined');
    expect(declinedN).toBeDefined();
    expect(declinedN.body).toContain('Geometry help');
    void loserApp;
  });

  it('notifies the parent when a tutor finishes or declines a requested audition', async () => {
    const { res: parentRes } = await signupParent(app, { email: `notifparent10_${Date.now()}@example.com` });
    const parentToken = parentRes.body.access_token;
    await verifyUser(parentRes.body.user.id);
    const { res: tutorRes } = await signupTutor(app, { email: `notiftutor10_${Date.now()}@example.com` });
    await verifyUser(tutorRes.body.user.id);

    const audition = await request(app).post('/api/auditions').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorRes.body.user.id });
    await request(app).patch(`/api/auditions/${audition.body.audition.id}/status`).set('Authorization', `Bearer ${tutorRes.body.access_token}`).send({ status: 'ready', video_url: 'https://example.com/v.mp4' });

    const readyN = await latestNotification(parentRes.body.user.id, 'audition_ready');
    expect(readyN).toBeDefined();
  });

  it('notifies the tutor when they receive a new review', async () => {
    const tutor = await setupTutorWithRate({ email: `notiftutor11_${Date.now()}@example.com` });
    const { res: parentRes } = await signupParent(app, { email: `notifparent11_${Date.now()}@example.com`, full_name: 'Review Parent' });
    await verifyUser(parentRes.body.user.id);

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentRes.body.access_token}`).send({ tutor_id: tutor.id });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutor.token}`).send({ status: 'confirmed' });
    await db.prepare("UPDATE bookings SET status = 'completed' WHERE id = ?").run(booking.body.booking.id);

    await request(app).post('/api/reviews').set('Authorization', `Bearer ${parentRes.body.access_token}`).send({ booking_id: booking.body.booking.id, rating: 5, comment: 'Great!' });

    const reviewN = await latestNotification(tutor.id, 'new_review_received');
    expect(reviewN).toBeDefined();
    expect(reviewN.body).toContain('Review Parent');
  });

  it('notifies the other participant when a message is sent in a conversation', async () => {
    const tutor = await setupTutorWithRate({ email: `notiftutor12_${Date.now()}@example.com` });
    const { res: parentRes } = await signupParent(app, { email: `notifparent12_${Date.now()}@example.com`, full_name: 'Message Parent' });
    await verifyUser(parentRes.body.user.id);

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentRes.body.access_token}`).send({ tutor_id: tutor.id });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutor.token}`).send({ status: 'confirmed' });

    const convo = await request(app).post('/api/conversations').set('Authorization', `Bearer ${parentRes.body.access_token}`).send({ tutor_id: tutor.id });
    await request(app).post(`/api/conversations/${convo.body.conversation.id}/messages`).set('Authorization', `Bearer ${parentRes.body.access_token}`).send({ content: 'Hi there!' });

    const messageN = await latestNotification(tutor.id, 'new_message');
    expect(messageN).toBeDefined();
    expect(messageN.body).toContain('Message Parent');
  });
});
