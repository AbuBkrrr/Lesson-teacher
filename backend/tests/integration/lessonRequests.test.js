const request = require('supertest');
const { getApp, signupParent, signupTutor, signupAdultStudent, verifyUser, unique } = require('../helpers');

const app = getApp();

async function verifiedParent(overrides = {}) {
  const { res } = await signupParent(app, { email: `${unique('lrparent')}@example.com`, ...overrides });
  await verifyUser(res.body.user.id);
  return res;
}

async function verifiedTutor(overrides = {}) {
  const { res } = await signupTutor(app, { email: `${unique('lrtutor')}@example.com`, ...overrides });
  await verifyUser(res.body.user.id);
  return res;
}

describe('post a search (lesson requests)', () => {
  it('a parent can post an open request and a tutor can browse it', async () => {
    const parent = await verifiedParent();
    const post = await request(app).post('/api/lesson-requests').set('Authorization', `Bearer ${parent.body.access_token}`)
      .send({ title: 'Need Algebra help', city: 'Lagos', online: true, min_budget: 3000, max_budget: 6000 });
    expect(post.status).toBe(201);
    expect(post.body.lesson_request.status).toBe('open');

    const tutor = await verifiedTutor();
    const open = await request(app).get('/api/lesson-requests/open?city=Lagos').set('Authorization', `Bearer ${tutor.body.access_token}`);
    expect(open.status).toBe(200);
    expect(open.body.lesson_requests.some((r) => r.id === post.body.lesson_request.id)).toBe(true);
  });

  it('an adult student can post a request for themselves with no parent involved', async () => {
    const { res: adultRes } = await signupAdultStudent(app, { email: `${unique('lradult')}@example.com` });
    await verifyUser(adultRes.body.user.id);
    const post = await request(app).post('/api/lesson-requests').set('Authorization', `Bearer ${adultRes.body.access_token}`)
      .send({ title: 'Need French tutoring' });
    expect(post.status).toBe(201);
    expect(post.body.lesson_request.requester_id).toBe(adultRes.body.user.id);
  });

  it('a tutor applying and the poster accepting auto-creates a booking', async () => {
    const parent = await verifiedParent();
    const post = await request(app).post('/api/lesson-requests').set('Authorization', `Bearer ${parent.body.access_token}`)
      .send({ title: 'Need Physics help' });
    const requestId = post.body.lesson_request.id;

    const tutor = await verifiedTutor();
    const applyRes = await request(app).post(`/api/lesson-requests/${requestId}/apply`)
      .set('Authorization', `Bearer ${tutor.body.access_token}`)
      .send({ message: 'I can help!', proposed_rate: 5000 });
    expect(applyRes.status).toBe(201);
    expect(applyRes.body.application.status).toBe('pending');

    const mine = await request(app).get('/api/lesson-requests/mine').set('Authorization', `Bearer ${parent.body.access_token}`);
    expect(mine.body.lesson_requests[0].applications.length).toBe(1);

    const accept = await request(app)
      .post(`/api/lesson-requests/${requestId}/applications/${applyRes.body.application.id}/accept`)
      .set('Authorization', `Bearer ${parent.body.access_token}`);
    expect(accept.status).toBe(200);
    expect(accept.body.booking).toBeTruthy();
    expect(accept.body.booking.tutor_id).toBe(tutor.body.user.id);
    expect(accept.body.booking.parent_id).toBe(parent.body.user.id);
    expect(accept.body.application.status).toBe('accepted');

    const closedRequest = await request(app).get('/api/lesson-requests/mine').set('Authorization', `Bearer ${parent.body.access_token}`);
    expect(closedRequest.body.lesson_requests.find((r) => r.id === requestId).status).toBe('closed');
  });

  it('a second application gets auto-declined once another is accepted', async () => {
    const parent = await verifiedParent();
    const post = await request(app).post('/api/lesson-requests').set('Authorization', `Bearer ${parent.body.access_token}`)
      .send({ title: 'Need Chemistry help' });
    const requestId = post.body.lesson_request.id;

    const tutorA = await verifiedTutor();
    const tutorB = await verifiedTutor();
    const appA = await request(app).post(`/api/lesson-requests/${requestId}/apply`).set('Authorization', `Bearer ${tutorA.body.access_token}`).send({});
    const appB = await request(app).post(`/api/lesson-requests/${requestId}/apply`).set('Authorization', `Bearer ${tutorB.body.access_token}`).send({});

    await request(app).post(`/api/lesson-requests/${requestId}/applications/${appA.body.application.id}/accept`)
      .set('Authorization', `Bearer ${parent.body.access_token}`);

    const mine = await request(app).get('/api/lesson-requests/mine').set('Authorization', `Bearer ${parent.body.access_token}`);
    const apps = mine.body.lesson_requests.find((r) => r.id === requestId).applications;
    expect(apps.find((a) => a.id === appA.body.application.id).status).toBe('accepted');
    expect(apps.find((a) => a.id === appB.body.application.id).status).toBe('declined');
  });

  it('rejects an unverified tutor applying, and an unverified parent posting', async () => {
    const { res: parentRes } = await signupParent(app, { email: `${unique('unvparent')}@example.com` });
    const unverifiedPost = await request(app).post('/api/lesson-requests').set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .send({ title: 'Need help' });
    expect(unverifiedPost.status).toBe(403);

    const parent = await verifiedParent();
    const post = await request(app).post('/api/lesson-requests').set('Authorization', `Bearer ${parent.body.access_token}`)
      .send({ title: 'Need help too' });

    const { res: tutorRes } = await signupTutor(app, { email: `${unique('unvtutor')}@example.com` });
    const unverifiedApply = await request(app).post(`/api/lesson-requests/${post.body.lesson_request.id}/apply`)
      .set('Authorization', `Bearer ${tutorRes.body.access_token}`).send({});
    expect(unverifiedApply.status).toBe(403);
  });

  it('only the requester can close or accept/decline applications on their own request', async () => {
    const parent = await verifiedParent();
    const other = await verifiedParent();
    const post = await request(app).post('/api/lesson-requests').set('Authorization', `Bearer ${parent.body.access_token}`)
      .send({ title: 'Need help' });

    const close = await request(app).patch(`/api/lesson-requests/${post.body.lesson_request.id}/close`)
      .set('Authorization', `Bearer ${other.body.access_token}`);
    expect(close.status).toBe(403);
  });
});
