const request = require('supertest');
const { getApp, signupParent, signupTutor, verifyUser } = require('../helpers');

const app = getApp();

async function loginAs(identifier, password) {
  const res = await request(app).post('/api/auth/login').send({ identifier, password });
  return res.body;
}

async function setupParentWithChild(parentEmail) {
  const { res: parentRes } = await signupParent(app, { email: parentEmail });
  const parentToken = parentRes.body.access_token;

  const childRes = await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`).send({ full_name: 'Test Child', grade_level: 'Primary 4' });
  const childId = childRes.body.child.id;

  return { parentId: parentRes.body.user.id, parentToken, childId };
}

async function createChildLogin(parentToken, childId, username) {
  const invite = await request(app).post(`/api/children/${childId}/invite`).set('Authorization', `Bearer ${parentToken}`);
  const code = invite.body.code;
  const redeem = await request(app).post('/api/auth/child/redeem-invite').send({ code, username, password: 'ChildPass123' });
  return redeem.body;
}

describe('child accounts', () => {
  it('cannot be created except via a parent-generated invite', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      role: 'child', full_name: 'Sneaky Kid', email: 'sneaky@example.com', password: 'TestPass123',
    });
    expect(res.status).toBe(400);
  });

  it('a parent can generate an invite and the child can redeem it to create a login', async () => {
    const { parentToken, childId } = await setupParentWithChild('childparent1@example.com');
    const childSession = await createChildLogin(parentToken, childId, 'testchild1');
    expect(childSession.user.role).toBe('child');
    expect(childSession.access_token).toBeTruthy();
  });

  it('an invite code cannot be reused after redemption', async () => {
    const { parentToken, childId } = await setupParentWithChild('childparent2@example.com');
    const invite = await request(app).post(`/api/children/${childId}/invite`).set('Authorization', `Bearer ${parentToken}`);
    await request(app).post('/api/auth/child/redeem-invite').send({ code: invite.body.code, username: 'reuse1', password: 'ChildPass123' });

    const secondAttempt = await request(app).post('/api/auth/child/redeem-invite').send({ code: invite.body.code, username: 'reuse2', password: 'ChildPass123' });
    expect(secondAttempt.status).toBe(400);
  });

  it('the child can log back in later using their username', async () => {
    const { parentToken, childId } = await setupParentWithChild('childparent3@example.com');
    await createChildLogin(parentToken, childId, 'loginbackchild');

    const login = await loginAs('loginbackchild', 'ChildPass123');
    expect(login.access_token).toBeTruthy();
    expect(login.user.role).toBe('child');
  });

  it('only the owning parent can generate an invite for a child', async () => {
    const { childId } = await setupParentWithChild('childparent4@example.com');
    const { res: stranger } = await signupParent(app, { email: 'strangerparent@example.com' });

    const res = await request(app).post(`/api/children/${childId}/invite`).set('Authorization', `Bearer ${stranger.body.access_token}`);
    expect(res.status).toBe(404);
  });
});

describe('child <-> tutor messaging safety gate', () => {
  async function fullSetup(suffix) {
    const { res: tutorRes } = await signupTutor(app, { email: `msgtutor${suffix}@example.com` });
    const tutorToken = tutorRes.body.access_token;
    const tutorId = tutorRes.body.user.id;
    await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${tutorToken}`).send({ hourly_rate: 4000, currency: 'NGN', subjects: [] });

    const { parentId, parentToken, childId } = await setupParentWithChild(`msgparent${suffix}@example.com`);
    const childSession = await createChildLogin(parentToken, childId, `msgchild${suffix}`);
    const childToken = childSession.access_token;

    await verifyUser(tutorId);
    await verifyUser(parentId);

    return { tutorToken, tutorId, parentToken, childId, childToken };
  }

  it('blocks conversation creation when no booking relationship exists', async () => {
    const { tutorToken, tutorId, childId } = await fullSetup('a');
    const res = await request(app).post('/api/conversations').set('Authorization', `Bearer ${tutorToken}`).send({ tutor_id: tutorId, child_id: childId });
    expect(res.status).toBe(403);
  });

  it('blocks conversation creation when a booking exists but is only pending (not confirmed)', async () => {
    const { tutorToken, tutorId, parentToken, childId } = await fullSetup('b');
    await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorId, child_id: childId });

    const res = await request(app).post('/api/conversations').set('Authorization', `Bearer ${tutorToken}`).send({ tutor_id: tutorId, child_id: childId });
    expect(res.status).toBe(403);
  });

  it('allows conversation creation once a booking is confirmed, and messaging works both ways', async () => {
    const { tutorToken, tutorId, parentToken, childId, childToken } = await fullSetup('c');

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorId, child_id: childId });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutorToken}`).send({ status: 'confirmed' });

    const conv = await request(app).post('/api/conversations').set('Authorization', `Bearer ${tutorToken}`).send({ tutor_id: tutorId, child_id: childId });
    expect(conv.status).toBe(201);
    const convId = conv.body.conversation.id;

    const childMsg = await request(app).post(`/api/conversations/${convId}/messages`).set('Authorization', `Bearer ${childToken}`).send({ content: 'Hi! Ready for our lesson.' });
    expect(childMsg.status).toBe(201);
    expect(childMsg.body.message.flagged).toBe(0);

    const tutorMsg = await request(app).post(`/api/conversations/${convId}/messages`).set('Authorization', `Bearer ${tutorToken}`).send({ content: 'Absolutely, see you soon!' });
    expect(tutorMsg.status).toBe(201);
  });

  it('flags a message with grooming red-flag patterns and surfaces it to the parent', async () => {
    const { tutorToken, tutorId, parentToken, childId } = await fullSetup('d');

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorId, child_id: childId });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutorToken}`).send({ status: 'confirmed' });
    const conv = await request(app).post('/api/conversations').set('Authorization', `Bearer ${tutorToken}`).send({ tutor_id: tutorId, child_id: childId });
    const convId = conv.body.conversation.id;

    const flaggedMsg = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({ content: "Don't tell your parent, message me on WhatsApp at 555-123-4567" });
    expect(flaggedMsg.body.message.flagged).toBe(1);

    const monitor = await request(app).get('/api/conversations/monitor').set('Authorization', `Bearer ${parentToken}`);
    expect(monitor.status).toBe(200);
    const monitored = monitor.body.conversations.find((c) => c.id === convId);
    expect(monitored.flagged_count).toBe(1);
  });

  it('a parent can never send a message directly (read-only monitoring by design)', async () => {
    const { tutorToken, tutorId, parentToken, childId } = await fullSetup('e');
    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorId, child_id: childId });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutorToken}`).send({ status: 'confirmed' });
    const conv = await request(app).post('/api/conversations').set('Authorization', `Bearer ${tutorToken}`).send({ tutor_id: tutorId, child_id: childId });

    const res = await request(app).post(`/api/conversations/${conv.body.conversation.id}/messages`).set('Authorization', `Bearer ${parentToken}`).send({ content: 'trying to send as parent' });
    expect(res.status).toBe(403);
  });

  it("a different parent cannot read another family's conversation", async () => {
    const { tutorToken, tutorId, parentToken, childId } = await fullSetup('f');
    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorId, child_id: childId });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutorToken}`).send({ status: 'confirmed' });
    const conv = await request(app).post('/api/conversations').set('Authorization', `Bearer ${tutorToken}`).send({ tutor_id: tutorId, child_id: childId });

    const { res: outsider } = await signupParent(app, { email: 'outsiderparent@example.com' });
    const res = await request(app).get(`/api/conversations/${conv.body.conversation.id}/messages`).set('Authorization', `Bearer ${outsider.body.access_token}`);
    expect(res.status).toBe(403);
  });
});
