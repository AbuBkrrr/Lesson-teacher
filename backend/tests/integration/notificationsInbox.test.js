const request = require('supertest');
const { getApp, signupParent, signupTutor } = require('../helpers');

const app = getApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('in-app notifications inbox', () => {
  it('records an in-app entry per event, with unread count, mark-read and isolation', async () => {
    const { res: tutor } = await signupTutor(app);
    const { res: parent } = await signupParent(app);

    // Verifying email via signup already created an in_app "verify email" entry for each user.
    const before = await request(app).get('/api/notifications').set(auth(parent.body.access_token));
    expect(before.status).toBe(200);
    expect(before.body.unread_count).toBeGreaterThan(0);
    const first = before.body.notifications[0];
    expect(first).toMatchObject({ subject: expect.any(String), body: expect.any(String) });
    expect(first.read_at).toBeNull();

    // Another user can't mark it read
    const other = await request(app).patch(`/api/notifications/${first.id}/read`).set(auth(tutor.body.access_token));
    expect(other.status).toBe(404);

    const read = await request(app).patch(`/api/notifications/${first.id}/read`).set(auth(parent.body.access_token));
    expect(read.status).toBe(200);
    const count = await request(app).get('/api/notifications/unread-count').set(auth(parent.body.access_token));
    expect(count.body.unread_count).toBe(before.body.unread_count - 1);

    const all = await request(app).post('/api/notifications/read-all').set(auth(parent.body.access_token));
    expect(all.body.unread_count).toBe(0);
    const unread = await request(app).get('/api/notifications?unread=true').set(auth(parent.body.access_token));
    expect(unread.body.notifications).toHaveLength(0);

    const anon = await request(app).get('/api/notifications');
    expect(anon.status).toBe(401);
  });
});
