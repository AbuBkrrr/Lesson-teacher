const request = require('supertest');
const { getApp, signupTutor, signupParent } = require('../helpers');

const app = getApp();

describe('tutor favorites', () => {
  it('a parent can favorite a tutor, see it listed, and unfavorite it', async () => {
    const { res: tutorRes } = await signupTutor(app);
    const { res: parentRes } = await signupParent(app);
    const parentToken = parentRes.body.access_token;

    const add = await request(app).post(`/api/tutors/${tutorRes.body.user.id}/favorite`).set('Authorization', `Bearer ${parentToken}`);
    expect(add.status).toBe(201);

    const list = await request(app).get('/api/tutors/favorites/mine').set('Authorization', `Bearer ${parentToken}`);
    expect(list.status).toBe(200);
    expect(list.body.tutors).toHaveLength(1);
    expect(list.body.tutors[0].user_id).toBe(tutorRes.body.user.id);
    expect(list.body.tutors[0].full_name).toBe('Test Tutor');

    const remove = await request(app).delete(`/api/tutors/${tutorRes.body.user.id}/favorite`).set('Authorization', `Bearer ${parentToken}`);
    expect(remove.status).toBe(200);

    const listAfter = await request(app).get('/api/tutors/favorites/mine').set('Authorization', `Bearer ${parentToken}`);
    expect(listAfter.body.tutors).toHaveLength(0);
  });

  it('favoriting twice is a no-op, not a duplicate or an error', async () => {
    const { res: tutorRes } = await signupTutor(app);
    const { res: parentRes } = await signupParent(app);
    const parentToken = parentRes.body.access_token;

    await request(app).post(`/api/tutors/${tutorRes.body.user.id}/favorite`).set('Authorization', `Bearer ${parentToken}`);
    const second = await request(app).post(`/api/tutors/${tutorRes.body.user.id}/favorite`).set('Authorization', `Bearer ${parentToken}`);
    expect(second.status).toBe(201);

    const list = await request(app).get('/api/tutors/favorites/mine').set('Authorization', `Bearer ${parentToken}`);
    expect(list.body.tutors).toHaveLength(1);
  });

  it('404s when favoriting a non-tutor id', async () => {
    const { res: parentRes } = await signupParent(app);
    const { res: otherParentRes } = await signupParent(app);
    const res = await request(app)
      .post(`/api/tutors/${otherParentRes.body.user.id}/favorite`)
      .set('Authorization', `Bearer ${parentRes.body.access_token}`);
    expect(res.status).toBe(404);
  });

  it('a tutor cannot favorite another tutor (role-gated)', async () => {
    const { res: tutorRes } = await signupTutor(app);
    const { res: otherTutorRes } = await signupTutor(app);
    const res = await request(app)
      .post(`/api/tutors/${otherTutorRes.body.user.id}/favorite`)
      .set('Authorization', `Bearer ${tutorRes.body.access_token}`);
    expect(res.status).toBe(403);
  });
});
