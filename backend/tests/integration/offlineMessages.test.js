const request = require('supertest');
const { getApp, signupTutor, signupParent, verifyUser } = require('../helpers');

const app = getApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('offline-safe messaging', () => {
  it('stores a retried message once, and returns only newer messages with ?after=', async () => {
    const { res: t } = await signupTutor(app);
    const { res: p } = await signupParent(app);
    await verifyUser(t.body.user.id); await verifyUser(p.body.user.id);
    const bk = await request(app).post('/api/bookings').set(auth(p.body.access_token)).send({ tutor_id: t.body.user.id });
    await request(app).patch(`/api/bookings/${bk.body.booking.id}/status`).set(auth(t.body.access_token)).send({ status: 'confirmed' });
    const conv = await request(app).post('/api/conversations').set(auth(p.body.access_token)).send({ tutor_id: t.body.user.id });
    expect([200, 201]).toContain(conv.status);
    const id = conv.body.conversation.id;

    const first = await request(app).post(`/api/conversations/${id}/messages`).set(auth(p.body.access_token)).send({ content: 'Hello', client_id: 'c-1' });
    expect(first.status).toBe(201);
    const retry = await request(app).post(`/api/conversations/${id}/messages`).set(auth(p.body.access_token)).send({ content: 'Hello', client_id: 'c-1' });
    expect(retry.status).toBe(200);
    expect(retry.body.message.id).toBe(first.body.message.id);
    const [a, b] = await Promise.all([1, 2].map(() => request(app).post(`/api/conversations/${id}/messages`).set(auth(p.body.access_token)).send({ content: 'Race', client_id: 'c-2' })));
    expect(a.body.message.id).toBe(b.body.message.id);

    const all = await request(app).get(`/api/conversations/${id}/messages`).set(auth(p.body.access_token));
    expect(all.body.messages.map((m) => m.content)).toEqual(['Hello', 'Race']);
    const delta = await request(app).get(`/api/conversations/${id}/messages?after=${encodeURIComponent(first.body.message.created_at)}`).set(auth(p.body.access_token));
    expect(delta.body.messages.map((m) => m.content)).toEqual(['Race']);
  });
});
