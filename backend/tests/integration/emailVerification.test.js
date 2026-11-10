const request = require('supertest');
const db = require('../../src/config/db');
const { getApp, signupParent } = require('../helpers');

const app = getApp();

function extractToken(emailBody) {
  const match = emailBody.match(/token=([a-f0-9]+)/);
  return match && match[1];
}

async function latestVerifyEmail(userId) {
  return db.prepare(
    "SELECT * FROM notifications WHERE user_id = ? AND type = 'verify_email' ORDER BY created_at DESC LIMIT 1"
  ).get(userId);
}

describe('email verification', () => {
  it('sends a verification email on signup, and the token marks the account verified', async () => {
    const { res: signupRes } = await signupParent(app);
    const userId = signupRes.body.user.id;

    expect(signupRes.body.user.email_verified_at).toBeFalsy();

    const emailRow = await latestVerifyEmail(userId);
    expect(emailRow).toBeDefined();
    const token = extractToken(emailRow.body);
    expect(token).toBeTruthy();

    const verify = await request(app).post('/api/auth/verify-email').send({ token });
    expect(verify.status).toBe(200);

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    expect(user.email_verified_at).toBeTruthy();
  });

  it('a verification token cannot be reused', async () => {
    const { res: signupRes } = await signupParent(app);
    const token = extractToken((await latestVerifyEmail(signupRes.body.user.id)).body);

    const first = await request(app).post('/api/auth/verify-email').send({ token });
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/auth/verify-email').send({ token });
    expect(second.status).toBe(400);
  });

  it('rejects a garbage token', async () => {
    const res = await request(app).post('/api/auth/verify-email').send({ token: 'not-a-real-token' });
    expect(res.status).toBe(400);
  });

  it('lets a logged-in user resend their verification email', async () => {
    const { res: signupRes } = await signupParent(app);
    const accessToken = signupRes.body.access_token;

    const resend = await request(app)
      .post('/api/auth/resend-verification')
      .set('Authorization', `Bearer ${accessToken}`)
      .send();
    expect(resend.status).toBe(200);

    // Signup's own email already produced one notification; resend should add a second.
    const rows = await db.prepare(
      "SELECT * FROM notifications WHERE user_id = ? AND type = 'verify_email' AND channel = 'email'"
    ).all(signupRes.body.user.id);
    expect(rows.length).toBe(2);
  });

  it('rejects resend without auth', async () => {
    const res = await request(app).post('/api/auth/resend-verification').send();
    expect(res.status).toBe(401);
  });

  it('short-circuits resend once already verified', async () => {
    const { res: signupRes } = await signupParent(app);
    const accessToken = signupRes.body.access_token;
    const token = extractToken((await latestVerifyEmail(signupRes.body.user.id)).body);
    await request(app).post('/api/auth/verify-email').send({ token });

    const resend = await request(app)
      .post('/api/auth/resend-verification')
      .set('Authorization', `Bearer ${accessToken}`)
      .send();
    expect(resend.status).toBe(200);
    expect(resend.body.message).toMatch(/already verified/i);

    const rows = await db.prepare(
      "SELECT * FROM notifications WHERE user_id = ? AND type = 'verify_email' AND channel = 'email'"
    ).all(signupRes.body.user.id);
    expect(rows.length).toBe(1); // no second email sent
  });
});
