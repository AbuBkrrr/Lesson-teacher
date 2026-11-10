const request = require('supertest');
const { getApp, signupParent, signupTutor, verifyUser } = require('../helpers');

const app = getApp();

async function setupParentWithChild(parentEmail) {
  const { res: parentRes } = await signupParent(app, { email: parentEmail });
  const parentToken = parentRes.body.access_token;
  const childRes = await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`).send({ full_name: 'Test Child', grade_level: 'Primary 4' });
  return { parentId: parentRes.body.user.id, parentToken, childId: childRes.body.child.id };
}

async function createChildLogin(parentToken, childId, username) {
  const invite = await request(app).post(`/api/children/${childId}/invite`).set('Authorization', `Bearer ${parentToken}`);
  const redeem = await request(app).post('/api/auth/child/redeem-invite').send({ code: invite.body.code, username, password: 'ChildPass123' });
  return redeem.body;
}

describe('child self-service endpoints (mobile app support)', () => {
  it('GET /api/children/me lets a child discover their own child_id', async () => {
    const { parentToken, childId } = await setupParentWithChild('childme1@example.com');
    const childSession = await createChildLogin(parentToken, childId, 'childme1');

    const res = await request(app).get('/api/children/me').set('Authorization', `Bearer ${childSession.access_token}`);
    expect(res.status).toBe(200);
    expect(res.body.child.id).toBe(childId);
  });

  it('GET /api/children/me is not available to a parent', async () => {
    const { parentToken } = await setupParentWithChild('childme2@example.com');
    const res = await request(app).get('/api/children/me').set('Authorization', `Bearer ${parentToken}`);
    expect(res.status).toBe(403);
  });

  it('a child can fetch the detail of their own booking', async () => {
    const { parentId, parentToken, childId } = await setupParentWithChild('childbooking1@example.com');
    const childSession = await createChildLogin(parentToken, childId, 'childbooking1');
    await verifyUser(parentId);

    const { res: tutorRes } = await signupTutor(app, { email: 'childbookingtutor1@example.com' });
    await verifyUser(tutorRes.body.user.id);

    const bookingRes = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorRes.body.user.id, child_id: childId, subject: 'Physics' });
    expect(bookingRes.status).toBe(201);

    const detail = await request(app).get(`/api/bookings/${bookingRes.body.booking.id}`).set('Authorization', `Bearer ${childSession.access_token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.booking.id).toBe(bookingRes.body.booking.id);
  });

  it("a child cannot fetch another child's booking", async () => {
    const { parentId: parentIdA, parentToken: parentA, childId: childIdA } = await setupParentWithChild('childbooking2a@example.com');
    const { parentToken: parentB, childId: childIdB } = await setupParentWithChild('childbooking2b@example.com');
    await verifyUser(parentIdA);

    const childBSession = await createChildLogin(parentB, childIdB, 'childbooking2b');

    const { res: tutorRes } = await signupTutor(app, { email: 'childbookingtutor2@example.com' });
    await verifyUser(tutorRes.body.user.id);

    const bookingRes = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentA}`).send({ tutor_id: tutorRes.body.user.id, child_id: childIdA, subject: 'Chemistry' });
    expect(bookingRes.status).toBe(201);

    const detail = await request(app).get(`/api/bookings/${bookingRes.body.booking.id}`).set('Authorization', `Bearer ${childBSession.access_token}`);
    expect(detail.status).toBe(403);
  });
});
