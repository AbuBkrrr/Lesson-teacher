const request = require('supertest');
const { getApp, signupParent, signupTutor, verifyUser } = require('../helpers');

const app = getApp();

describe('account data export', () => {
  it('exports the caller\'s own profile and related data', async () => {
    const { res: tutorRes } = await signupTutor(app);
    await verifyUser(tutorRes.body.user.id);
    const { res: parentRes } = await signupParent(app);
    await verifyUser(parentRes.body.user.id);

    await request(app).post('/api/bookings')
      .set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .send({ tutor_id: tutorRes.body.user.id, subject: 'History' });

    const exportRes = await request(app).get('/api/account/export').set('Authorization', `Bearer ${parentRes.body.access_token}`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.profile.id).toBe(parentRes.body.user.id);
    expect(exportRes.body.profile.password_hash).toBeUndefined();
    expect(exportRes.body.bookings.as_parent).toHaveLength(1);
    expect(exportRes.body.bookings.as_parent[0].subject).toBe('History');
    expect(Array.isArray(exportRes.body.children)).toBe(true);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/account/export');
    expect(res.status).toBe(401);
  });
});

describe('account deletion', () => {
  it('soft-deletes the account after confirming the password, revokes sessions, and blocks future login', async () => {
    const { res: parentRes, email, password } = await signupParent(app);
    const refreshToken = parentRes.body.refresh_token;

    const wrongPassword = await request(app).post('/api/account/delete')
      .set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .send({ password: 'totallyWrongPass123' });
    expect(wrongPassword.status).toBe(401);

    const del = await request(app).post('/api/account/delete')
      .set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .send({ password });
    expect(del.status).toBe(200);

    const loginAttempt = await request(app).post('/api/auth/login').send({ identifier: email, password });
    expect(loginAttempt.status).toBe(401);

    const refreshAttempt = await request(app).post('/api/auth/refresh').send({ refresh_token: refreshToken });
    expect(refreshAttempt.status).toBe(401);
  });

  it('requires a password in the request body', async () => {
    const { res: parentRes } = await signupParent(app);
    const res = await request(app).post('/api/account/delete')
      .set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
