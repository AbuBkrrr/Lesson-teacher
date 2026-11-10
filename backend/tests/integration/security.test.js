const request = require('supertest');
const { getApp, unique } = require('../helpers');

const app = getApp();

describe('security headers and hardening', () => {
  it('sets helmet security headers on every response', async () => {
    const res = await request(app).get('/api/skills');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-dns-prefetch-control']).toBeTruthy();
    // Powered-by header is a free fingerprinting signal for attackers — helmet strips it.
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('rate-limits repeated login attempts', async () => {
    const email = `${unique('ratelimit')}@example.com`;
    let lastStatus;
    for (let i = 0; i < 35; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).post('/api/auth/login').send({ identifier: email, password: 'wrong-password' });
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  });

  it('rejects an expired/invalid JWT on a protected route', async () => {
    const res = await request(app).get('/api/bookings/mine').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('rejects an unauthenticated request to a protected route', async () => {
    const res = await request(app).get('/api/bookings/mine');
    expect(res.status).toBe(401);
  });

  it('exposes Prometheus metrics at /metrics', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/http_requests_total/);
  });
});
