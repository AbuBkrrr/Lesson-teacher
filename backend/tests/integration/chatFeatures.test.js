const request = require('supertest');
const db = require('../../src/config/db');
const { getApp, signupTutor, signupParent, verifyUser } = require('../helpers');

const app = getApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function setup() {
  const { res: t } = await signupTutor(app);
  const { res: p } = await signupParent(app);
  await verifyUser(t.body.user.id); await verifyUser(p.body.user.id);
  const bk = await request(app).post('/api/bookings').set(auth(p.body.access_token)).send({ tutor_id: t.body.user.id });
  await request(app).patch(`/api/bookings/${bk.body.booking.id}/status`).set(auth(t.body.access_token)).send({ status: 'confirmed' });
  const conv = await request(app).post('/api/conversations').set(auth(p.body.access_token)).send({ tutor_id: t.body.user.id });
  return { t: t.body, p: p.body, id: conv.body.conversation.id };
}

describe('chat features', () => {
  it('supports replies, reactions, attachments and export', async () => {
    const { t, p, id } = await setup();
    const m1 = await request(app).post(`/api/conversations/${id}/messages`).set(auth(p.access_token)).send({ content: 'Question?' });
    const reply = await request(app).post(`/api/conversations/${id}/messages`).set(auth(t.access_token)).send({ content: 'Answer', reply_to_id: m1.body.message.id });
    expect(reply.status).toBe(201);
    expect(reply.body.message.reply_to).toMatchObject({ id: m1.body.message.id, content: 'Question?' });
    expect((await request(app).post(`/api/conversations/${id}/messages`).set(auth(t.access_token)).send({ content: 'x', reply_to_id: 'nope' })).status).toBe(400);

    const rx = await request(app).put(`/api/conversations/${id}/messages/${m1.body.message.id}/reaction`).set(auth(t.access_token)).send({ emoji: '👍' });
    expect(rx.body.message.reactions).toEqual([{ user_id: t.user.id, emoji: '👍' }]);
    expect((await request(app).put(`/api/conversations/${id}/messages/${m1.body.message.id}/reaction`).set(auth(t.access_token)).send({ emoji: '💩' })).status).toBe(400);
    const rm = await request(app).put(`/api/conversations/${id}/messages/${m1.body.message.id}/reaction`).set(auth(t.access_token)).send({ emoji: null });
    expect(rm.body.message.reactions).toEqual([]);

    const att = await request(app).post(`/api/conversations/${id}/messages`).set(auth(p.access_token))
      .field('content', '').attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'hw.pdf', contentType: 'application/pdf' });
    expect(att.status).toBe(201);
    expect(att.body.message).toMatchObject({ attachment_name: 'hw.pdf', attachment_type: 'application/pdf' });
    expect(att.body.message.attachment_url).toMatch(/\/uploads\//);
    const bad = await request(app).post(`/api/conversations/${id}/messages`).set(auth(p.access_token))
      .attach('file', Buffer.from('MZ'), { filename: 'a.exe', contentType: 'application/x-msdownload' });
    expect(bad.status).toBe(400);

    const list = await request(app).get('/api/conversations/mine').set(auth(t.access_token));
    expect(list.body.conversations[0].last_message.content).toContain('hw.pdf');
    const exp = await request(app).get('/api/conversations/export').set(auth(p.access_token));
    expect(exp.status).toBe(200);
    expect(exp.body.conversations[0].messages.length).toBe(3);
  });

  it('disappearing messages expire and are purged; presence reports heartbeat', async () => {
    const { t, p, id } = await setup();
    expect((await request(app).patch(`/api/conversations/${id}/settings`).set(auth(p.access_token)).send({ disappear_after_seconds: 5 })).status).toBe(400);
    expect((await request(app).patch(`/api/conversations/${id}/settings`).set(auth(p.access_token)).send({ disappear_after_seconds: 3600 })).status).toBe(200);
    const m = await request(app).post(`/api/conversations/${id}/messages`).set(auth(p.access_token)).send({ content: 'secret' });
    const row = await db.prepare('SELECT expires_at FROM messages WHERE id = ?').get(m.body.message.id);
    expect(Date.parse(row.expires_at)).toBeGreaterThan(Date.now());
    await db.prepare('UPDATE messages SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), m.body.message.id);
    const after = await request(app).get(`/api/conversations/${id}/messages`).set(auth(t.access_token));
    expect(after.body.messages).toHaveLength(0);
    await require('../../src/controllers/conversationController').purgeExpiredMessages();
    expect(await db.prepare('SELECT id FROM messages WHERE id = ?').get(m.body.message.id)).toBeUndefined();

    let pr = await request(app).get(`/api/conversations/${id}/presence`).set(auth(p.access_token));
    expect(pr.body.online).toBe(false);
    await db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), t.user.id);
    pr = await request(app).get(`/api/conversations/${id}/presence`).set(auth(p.access_token));
    expect(pr.body.online).toBe(true);
  });

  it('links a new device by code and lets a device be revoked', async () => {
    const { res } = await signupParent(app);
    await verifyUser(res.body.user.id);
    const start = await request(app).post('/api/auth/device-link/start').send({ label: 'Chrome on Mac' });
    expect(start.status).toBe(201);
    const { code, secret } = start.body;
    expect((await request(app).post('/api/auth/device-link/claim').send({ code, secret })).status).toBe(202);
    expect((await request(app).post('/api/auth/device-link/claim').send({ code, secret: 'wrong' })).status).toBe(404);
    expect((await request(app).post('/api/auth/device-link/approve').send({ code })).status).toBe(401);
    expect((await request(app).post('/api/auth/device-link/approve').set(auth(res.body.access_token)).send({ code })).status).toBe(200);
    const claim = await request(app).post('/api/auth/device-link/claim').send({ code, secret });
    expect(claim.status).toBe(200);
    expect(claim.body.user.id).toBe(res.body.user.id);
    expect((await request(app).post('/api/auth/device-link/claim').send({ code, secret })).status).toBe(409);

    const devs = await request(app).get('/api/auth/devices').set(auth(res.body.access_token)).set('X-Refresh-Token', claim.body.refresh_token);
    const linked = devs.body.devices.find((d) => d.label === 'Chrome on Mac');
    expect(linked.current).toBe(true);
    expect((await request(app).delete(`/api/auth/devices/${linked.id}`).set(auth(res.body.access_token))).status).toBe(200);
    expect((await request(app).post('/api/auth/refresh').send({ refresh_token: claim.body.refresh_token })).status).toBe(401);
  });
});
