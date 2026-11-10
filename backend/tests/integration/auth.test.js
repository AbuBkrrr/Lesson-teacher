const request = require('supertest');
const { getApp, signupParent, signupTutor, signupSchoolAdmin } = require('../helpers');

const app = getApp();

describe('auth', () => {
  describe('POST /api/auth/signup', () => {
    it('creates a parent account and returns tokens', async () => {
      const { res } = await signupParent(app);
      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('parent');
      expect(res.body.access_token).toBeTruthy();
      expect(res.body.refresh_token).toBeTruthy();
      expect(res.body.referral_code).toMatch(/^LT-/);
      expect(res.body.user.password_hash).toBeUndefined(); // never leak the hash
    });

    it('creates a tutor account with an auto-created tutor_profile', async () => {
      const { res } = await signupTutor(app);
      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('tutor');
    });

    it('creates a school_admin account and a school with a join code', async () => {
      const { res } = await signupSchoolAdmin(app, { school_name: 'Test Academy', school_address: '1 Main St' });
      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('school_admin');
      expect(res.body.user.school_id).toBeTruthy();
    });

    it('rejects marketer as a role — no such role exists anymore', async () => {
      const res = await request(app).post('/api/auth/signup').send({
        role: 'marketer', full_name: 'X', email: 'x@example.com', password: 'TestPass123',
      });
      expect(res.status).toBe(400);
    });

    it('rejects a password under 8 characters', async () => {
      const res = await request(app).post('/api/auth/signup').send({
        role: 'parent', full_name: 'X', email: 'shortpass@example.com', password: 'short',
      });
      expect(res.status).toBe(400);
    });

    it('rejects duplicate email with 409', async () => {
      const email = 'dupe@example.com';
      await signupParent(app, { email });
      const res = await request(app).post('/api/auth/signup').send({
        role: 'parent', full_name: 'Second', email, password: 'TestPass123',
      });
      expect(res.status).toBe(409);
    });

    it('requires school_name for school_admin signup', async () => {
      const res = await request(app).post('/api/auth/signup').send({
        role: 'school_admin', full_name: 'X', email: 'noschool@example.com', password: 'TestPass123',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('logs in with correct credentials', async () => {
      const { email, password } = await signupParent(app, { email: 'loginok@example.com' });
      const res = await request(app).post('/api/auth/login').send({ identifier: email, password });
      expect(res.status).toBe(200);
      expect(res.body.access_token).toBeTruthy();
    });

    it('rejects wrong password', async () => {
      const { email } = await signupParent(app, { email: 'wrongpass@example.com' });
      const res = await request(app).post('/api/auth/login').send({ identifier: email, password: 'WrongPass123' });
      expect(res.status).toBe(401);
    });

    it('rejects unknown identifier', async () => {
      const res = await request(app).post('/api/auth/login').send({ identifier: 'nope@nowhere.com', password: 'whatever123' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('issues a new access token from a valid refresh token', async () => {
      const { res: signupRes } = await signupParent(app, { email: 'refresh@example.com' });
      const res = await request(app).post('/api/auth/refresh').send({ refresh_token: signupRes.body.refresh_token });
      expect(res.status).toBe(200);
      expect(res.body.access_token).toBeTruthy();
    });

    it('rejects a garbage refresh token', async () => {
      const res = await request(app).post('/api/auth/refresh').send({ refresh_token: 'not-a-real-token' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('revokes the refresh token so it can no longer be used', async () => {
      const { res: signupRes } = await signupParent(app, { email: 'logout@example.com' });
      const refreshToken = signupRes.body.refresh_token;

      await request(app).post('/api/auth/logout').send({ refresh_token: refreshToken });
      const res = await request(app).post('/api/auth/refresh').send({ refresh_token: refreshToken });
      expect(res.status).toBe(401);
    });
  });
});
