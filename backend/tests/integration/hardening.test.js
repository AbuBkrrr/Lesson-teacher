const request = require('supertest');
const { getApp } = require('../helpers');

const app = getApp();

describe('input hardening', () => {
  const email = `Mixed.Case.${Date.now()}@Example.com`;

  it('stores email lowercase and logs in regardless of case', async () => {
    const s = await request(app).post('/api/auth/signup').send({ role: 'parent', full_name: 'Case Test', email, password: 'password123' });
    expect(s.status).toBe(201);
    expect(s.body.user.email).toBe(email.toLowerCase());
    const l = await request(app).post('/api/auth/login').send({ identifier: `  ${email.toUpperCase()} `, password: 'password123' });
    expect(l.status).toBe(200);
    const dup = await request(app).post('/api/auth/signup').send({ role: 'parent', full_name: 'Dup', email: email.toLowerCase(), password: 'password123' });
    expect(dup.status).toBe(409);
  });

  it('rejects bad email format and non-string fields with 400 (not 500)', async () => {
    const a = await request(app).post('/api/auth/signup').send({ role: 'parent', full_name: 'X', email: 'nope', password: 'password123' });
    expect(a.status).toBe(400);
    const b = await request(app).post('/api/auth/login').send({ identifier: { $ne: 1 }, password: ['x'] });
    expect(b.status).toBe(400);
    const c = await request(app).post('/api/auth/forgot-password').send({ identifier: { a: 1 } });
    expect(c.status).toBe(200);
  });

  it('returns 400 for malformed JSON', async () => {
    const r = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/malformed/i);
  });
});
