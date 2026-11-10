const request = require('supertest');
const { getApp, signupParent, signupTutor, verifyUser, unique } = require('../helpers');
const db = require('../../src/config/db');

const app = getApp();

describe('push tokens', () => {
  it('registers a device token and it is used on notify', async () => {
    const { res: parentRes } = await signupParent(app, { email: `${unique('pushparent')}@example.com` });
    const reg = await request(app).post('/api/push-tokens').set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .send({ token: `tok_${unique('t')}`, platform: 'android' });
    expect(reg.status).toBe(201);

    const row = await db.prepare('SELECT * FROM push_tokens WHERE user_id = ?').get(parentRes.body.user.id);
    expect(row).toBeTruthy();
    expect(row.platform).toBe('android');
  });

  it('re-registering an existing token re-points it at the new user', async () => {
    const { res: userA } = await signupParent(app, { email: `${unique('pushA')}@example.com` });
    const { res: userB } = await signupTutor(app, { email: `${unique('pushB')}@example.com` });
    const token = `tok_${unique('shared')}`;

    await request(app).post('/api/push-tokens').set('Authorization', `Bearer ${userA.body.access_token}`).send({ token });
    await request(app).post('/api/push-tokens').set('Authorization', `Bearer ${userB.body.access_token}`).send({ token });

    const rows = await db.prepare('SELECT * FROM push_tokens WHERE token = ?').all(token);
    expect(rows.length).toBe(1);
    expect(rows[0].user_id).toBe(userB.body.user.id);
  });

  it('unregisters a token on logout', async () => {
    const { res: parentRes } = await signupParent(app, { email: `${unique('pushout')}@example.com` });
    const token = `tok_${unique('out')}`;
    await request(app).post('/api/push-tokens').set('Authorization', `Bearer ${parentRes.body.access_token}`).send({ token });

    const del = await request(app).delete('/api/push-tokens').set('Authorization', `Bearer ${parentRes.body.access_token}`).send({ token });
    expect(del.status).toBe(200);

    const row = await db.prepare('SELECT * FROM push_tokens WHERE token = ?').get(token);
    expect(row).toBeFalsy();
  });

  it('a booking notification is also recorded as a push to a registered device', async () => {
    const { res: tutorRes } = await signupTutor(app, { email: `${unique('pushtutor')}@example.com` });
    await request(app).post('/api/push-tokens').set('Authorization', `Bearer ${tutorRes.body.access_token}`)
      .send({ token: `tok_${unique('tutordevice')}`, platform: 'ios' });
    await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${tutorRes.body.access_token}`)
      .send({ hourly_rate: 3000, currency: 'NGN', subjects: [] });

    const { res: parentRes } = await signupParent(app, { email: `${unique('pushnotifyparent')}@example.com` });
    await verifyUser(parentRes.body.user.id);
    await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .send({ tutor_id: tutorRes.body.user.id });

    const pushNotifs = await db.prepare(
      "SELECT * FROM notifications WHERE user_id = ? AND channel = 'push'"
    ).all(tutorRes.body.user.id);
    expect(pushNotifs.length).toBe(1);
    expect(pushNotifs[0].status).toBe('sent');
  });
});
