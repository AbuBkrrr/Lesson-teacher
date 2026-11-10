const request = require('supertest');
const db = require('../../src/config/db');
const { getApp, signupTutor, signupParent, verifyUser } = require('../helpers');

const app = getApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('message edit / delete', () => {
  it('lets the sender edit within 15 min and delete for everyone; others cannot', async () => {
    const { res: t } = await signupTutor(app);
    const { res: p } = await signupParent(app);
    await verifyUser(t.body.user.id); await verifyUser(p.body.user.id);
    const bk = await request(app).post('/api/bookings').set(auth(p.body.access_token)).send({ tutor_id: t.body.user.id });
    await request(app).patch(`/api/bookings/${bk.body.booking.id}/status`).set(auth(t.body.access_token)).send({ status: 'confirmed' });
    const conv = await request(app).post('/api/conversations').set(auth(p.body.access_token)).send({ tutor_id: t.body.user.id });
    const id = conv.body.conversation.id;
    const sent = await request(app).post(`/api/conversations/${id}/messages`).set(auth(p.body.access_token)).send({ content: 'Typo hree' });
    const mid = sent.body.message.id;
    const url = `/api/conversations/${id}/messages/${mid}`;

    expect((await request(app).patch(url).set(auth(t.body.access_token)).send({ content: 'hijack' })).status).toBe(403);
    const ed = await request(app).patch(url).set(auth(p.body.access_token)).send({ content: 'Typo here' });
    expect(ed.status).toBe(200);
    expect(ed.body.message.edited).toBe(true);

    const tutorView = await request(app).get(`/api/conversations/${id}/messages`).set(auth(t.body.access_token));
    expect(tutorView.body.messages[0].content).toBe('Typo here');
    expect(tutorView.body.messages[0].original_content).toBeUndefined();

    await db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 20 * 60000).toISOString(), mid);
    expect((await request(app).patch(url).set(auth(p.body.access_token)).send({ content: 'too late' })).status).toBe(403);

    expect((await request(app).delete(url).set(auth(t.body.access_token))).status).toBe(403);
    expect((await request(app).delete(url).set(auth(p.body.access_token))).status).toBe(200);
    const after = await request(app).get(`/api/conversations/${id}/messages`).set(auth(t.body.access_token));
    expect(after.body.messages[0]).toMatchObject({ deleted: true, content: '' });
    const delta = await request(app).get(`/api/conversations/${id}/messages?after=${encodeURIComponent(new Date().toISOString())}`).set(auth(t.body.access_token));
    expect(delta.status).toBe(200);
    const row = await db.prepare('SELECT original_content, deleted_at FROM messages WHERE id = ?').get(mid);
    expect(row.original_content).toBe('Typo hree');
    expect(row.deleted_at).toBeTruthy();
    expect((await request(app).patch(url).set(auth(p.body.access_token)).send({ content: 'x' })).status).toBe(409);
  });
});
