const request = require('supertest');
const { getApp, signupParent, signupTutor, verifyUser } = require('../helpers');

const app = getApp();

async function setupConfirmedBooking(parentEmail, tutorEmail, withChild = false) {
  const { res: tutorRes } = await signupTutor(app, { email: tutorEmail });
  const tutorToken = tutorRes.body.access_token;
  const tutorId = tutorRes.body.user.id;
  await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${tutorToken}`).send({ hourly_rate: 4000, currency: 'NGN', subjects: [] });

  const { res: parentRes } = await signupParent(app, { email: parentEmail });
  const parentToken = parentRes.body.access_token;
  const parentId = parentRes.body.user.id;
  await verifyUser(tutorId);
  await verifyUser(parentId);

  let childId;
  if (withChild) {
    const child = await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`).send({ full_name: 'Booking Kid' });
    childId = child.body.child.id;
  }

  const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorId, child_id: childId });
  await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutorToken}`).send({ status: 'confirmed' });

  return { tutorToken, tutorId, parentToken, parentId, childId };
}

describe('parent <-> tutor direct messaging', () => {
  it('blocks a parent from starting a conversation with a tutor they have no booking with', async () => {
    const { res: tutor } = await signupTutor(app, { email: 'nobookingtutor@example.com' });
    const { res: parent } = await signupParent(app, { email: 'nobookingparent@example.com' });

    const res = await request(app).post('/api/conversations').set('Authorization', `Bearer ${parent.body.access_token}`).send({ tutor_id: tutor.body.user.id });
    expect(res.status).toBe(403);
  });

  it('allows a parent to start and both sides to message once a booking is confirmed', async () => {
    const { tutorToken, tutorId, parentToken } = await setupConfirmedBooking('directparent1@example.com', 'directtutor1@example.com');

    const conv = await request(app).post('/api/conversations').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorId });
    expect(conv.status).toBe(201);
    expect(conv.body.conversation.kind).toBe('parent_tutor');
    const convId = conv.body.conversation.id;

    const parentMsg = await request(app).post(`/api/conversations/${convId}/messages`).set('Authorization', `Bearer ${parentToken}`).send({ content: 'Can we reschedule to Thursday?' });
    expect(parentMsg.status).toBe(201);

    const tutorMsg = await request(app).post(`/api/conversations/${convId}/messages`).set('Authorization', `Bearer ${tutorToken}`).send({ content: 'Thursday works for me!' });
    expect(tutorMsg.status).toBe(201);
  });

  it('a tutor cannot initiate a parent_tutor conversation (parent-initiated only)', async () => {
    const { tutorToken, tutorId } = await setupConfirmedBooking('tutorinitparent@example.com', 'tutorinittutor@example.com');
    const res = await request(app).post('/api/conversations').set('Authorization', `Bearer ${tutorToken}`).send({ tutor_id: tutorId });
    expect(res.status).toBe(403);
  });

  it('does not apply child-safety flagging to adult parent_tutor messages', async () => {
    const { tutorToken, tutorId, parentToken } = await setupConfirmedBooking('noflagparent@example.com', 'noflagtutor@example.com');
    const conv = await request(app).post('/api/conversations').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorId });

    const msg = await request(app)
      .post(`/api/conversations/${conv.body.conversation.id}/messages`)
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({ content: 'Feel free to message me on WhatsApp at 555-123-4567 for scheduling.' });
    expect(msg.body.message.flagged).toBe(0);
  });

  it("a parent's direct conversations and their child-monitoring view stay separate", async () => {
    const { tutorToken, tutorId, parentToken, childId } = await setupConfirmedBooking('sepparent@example.com', 'septutor@example.com', true);

    await request(app).post('/api/conversations').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorId });
    await request(app).post('/api/conversations').set('Authorization', `Bearer ${tutorToken}`).send({ tutor_id: tutorId, child_id: childId });

    const mine = await request(app).get('/api/conversations/mine').set('Authorization', `Bearer ${parentToken}`);
    expect(mine.body.conversations.length).toBe(1);
    expect(mine.body.conversations[0].kind).toBe('parent_tutor');

    const monitor = await request(app).get('/api/conversations/monitor').set('Authorization', `Bearer ${parentToken}`);
    expect(monitor.body.conversations.length).toBe(1);
    expect(monitor.body.conversations[0].kind).toBe('child_tutor');
  });

  it('a different tutor cannot read a parent_tutor conversation they are not part of', async () => {
    const { tutorId, parentToken } = await setupConfirmedBooking('isolparent@example.com', 'isoltutor@example.com');
    const conv = await request(app).post('/api/conversations').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorId });

    const { res: outsiderTutor } = await signupTutor(app, { email: 'outsidertutor@example.com' });
    const res = await request(app).get(`/api/conversations/${conv.body.conversation.id}/messages`).set('Authorization', `Bearer ${outsiderTutor.body.access_token}`);
    expect(res.status).toBe(403);
  });
});
