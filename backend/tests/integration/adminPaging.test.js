const request = require('supertest');
const { getApp, signupParent, createSuperAdmin } = require('../helpers');

const app = getApp();

async function adminToken() {
  const admin = await createSuperAdmin();
  const res = await request(app).post('/api/auth/login').send({ identifier: admin.email, password: admin.password });
  return res.body.access_token;
}

describe('admin user search', () => {
  it('finds users by name or email fragment, case-insensitively, and treats % literally', async () => {
    const token = await adminToken();
    const tag = `Zq${Date.now()}`;
    await signupParent(app, { full_name: `${tag} Findable` });
    await signupParent(app, { full_name: 'Someone Else' });
    const hit = await request(app).get(`/api/admin/users?q=${tag.toLowerCase()}`).set('Authorization', `Bearer ${token}`);
    expect(hit.status).toBe(200);
    expect(hit.body.users).toHaveLength(1);
    expect(hit.body.users[0].full_name).toContain('Findable');
    const wild = await request(app).get('/api/admin/users?q=%25').set('Authorization', `Bearer ${token}`);
    expect(wild.body.users).toHaveLength(0);
  });
});

describe('admin list paging', () => {
  it('pages users with a stable order and reports the total', async () => {
    const token = await adminToken();
    await signupParent(app);
    await signupParent(app);
    const auth = { Authorization: `Bearer ${token}` };

    const p1 = await request(app).get('/api/admin/users?page_size=2&page=1').set(auth);
    const p2 = await request(app).get('/api/admin/users?page_size=2&page=2').set(auth);
    expect(p1.status).toBe(200);
    expect(p1.body).toMatchObject({ page: 1, page_size: 2, total: 3 });
    expect(p1.body.users).toHaveLength(2);
    expect(p2.body.users).toHaveLength(1);
    const ids = [...p1.body.users, ...p2.body.users].map((u) => u.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('keeps the old behaviour by default and clamps page_size', async () => {
    const token = await adminToken();
    const auth = { Authorization: `Bearer ${token}` };
    const res = await request(app).get('/api/admin/users?page_size=99999').set(auth);
    expect(res.body.page_size).toBe(200);
    for (const path of ['bookings', 'payments', 'auditions', 'payouts']) {
      const url = path === 'payouts' ? '/api/admin/payouts' : `/api/${path}/mine`;
      const r = await request(app).get(url).set(auth);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ page: 1, page_size: 200, total: 0 });
    }
  });
});
