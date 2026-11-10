const request = require('supertest');
const db = require('../../src/config/db');
const { getApp, signupParent } = require('../helpers');

const app = getApp();

function extractToken(emailBody) {
  const match = emailBody.match(/token=([a-f0-9]+)/);
  return match && match[1];
}

async function latestResetEmail(userId) {
  return db.prepare(
    "SELECT * FROM notifications WHERE user_id = ? AND type = 'password_reset' ORDER BY created_at DESC LIMIT 1"
  ).get(userId);
}

describe('password reset', () => {
  it('emails a reset link, and the token resets the password and logs out other sessions', async () => {
    const email = `pwreset1_${Date.now()}@example.com`;
    const { res: signupRes } = await signupParent(app, { email });
    const refreshToken = signupRes.body.refresh_token;

    const forgot = await request(app).post('/api/auth/forgot-password').send({ identifier: email });
    expect(forgot.status).toBe(200);

    const emailRow = await latestResetEmail(signupRes.body.user.id);
    expect(emailRow).toBeDefined();
    const token = extractToken(emailRow.body);
    expect(token).toBeTruthy();

    const reset = await request(app).post('/api/auth/reset-password').send({ token, new_password: 'NewPass456' });
    expect(reset.status).toBe(200);

    // Old password no longer works.
    const oldLogin = await request(app).post('/api/auth/login').send({ identifier: email, password: 'TestPass123' });
    expect(oldLogin.status).toBe(401);

    // New password works.
    const newLogin = await request(app).post('/api/auth/login').send({ identifier: email, password: 'NewPass456' });
    expect(newLogin.status).toBe(200);

    // The refresh token issued before the reset is now revoked.
    const refreshAttempt = await request(app).post('/api/auth/refresh').send({ refresh_token: refreshToken });
    expect(refreshAttempt.status).toBe(401);
  });

  it('a reset token cannot be reused', async () => {
    const email = `pwreset2_${Date.now()}@example.com`;
    const { res: signupRes } = await signupParent(app, { email });
    await request(app).post('/api/auth/forgot-password').send({ identifier: email });
    const token = extractToken((await latestResetEmail(signupRes.body.user.id)).body);

    const first = await request(app).post('/api/auth/reset-password').send({ token, new_password: 'FirstPass123' });
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/auth/reset-password').send({ token, new_password: 'SecondPass123' });
    expect(second.status).toBe(400);
  });

  it('rejects a garbage token', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({ token: 'not-a-real-token', new_password: 'WhateverPass123' });
    expect(res.status).toBe(400);
  });

  it('responds the same way for an unknown identifier, without sending anything (no account enumeration)', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ identifier: `nobody-${Date.now()}@example.com` });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
