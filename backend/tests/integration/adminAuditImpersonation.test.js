const request = require('supertest');
const { getApp, signupParent, createSuperAdmin } = require('../helpers');

const app = getApp();

async function adminToken() {
  const admin = await createSuperAdmin();
  const res = await request(app).post('/api/auth/login').send({ identifier: admin.email, password: admin.password });
  return { token: res.body.access_token, id: admin.id };
}

describe('admin audit log', () => {
  it('records suspend, reactivate, and settings changes, newest first, without leaking the account number', async () => {
    const { token } = await adminToken();
    const { res: parent } = await signupParent(app);
    const uid = parent.body.user.id;

    await request(app).post(`/api/admin/users/${uid}/suspend`).set('Authorization', `Bearer ${token}`);
    await request(app).post(`/api/admin/users/${uid}/reactivate`).set('Authorization', `Bearer ${token}`);
    await request(app).patch('/api/admin/settings').set('Authorization', `Bearer ${token}`)
      .send({ commission_percent: 12, transfer_account_number: '0123456789' });

    const log = await request(app).get('/api/admin/audit-log').set('Authorization', `Bearer ${token}`);
    expect(log.status).toBe(200);
    expect(log.body.entries.map((e) => e.action)).toEqual(['settings.update', 'user.reactivate', 'user.suspend']);
    expect(log.body.entries[0].admin_name).toBe('Test Admin');
    expect(log.body.entries[0].details.fields).toEqual(expect.arrayContaining(['commission_percent', 'transfer_account_number']));
    expect(JSON.stringify(log.body.entries[0].details)).not.toContain('0123456789');
    expect(log.body.entries[1].target_id).toBe(uid);
  });

  it('is super_admin only', async () => {
    const { res: parent } = await signupParent(app);
    const res = await request(app).get('/api/admin/audit-log').set('Authorization', `Bearer ${parent.body.access_token}`);
    expect(res.status).toBe(403);
  });
});

describe('admin impersonation', () => {
  it('issues a working access token for the target, logs it, and issues no refresh token', async () => {
    const { token } = await adminToken();
    const { res: parent } = await signupParent(app);

    const imp = await request(app).post(`/api/admin/users/${parent.body.user.id}/impersonate`).set('Authorization', `Bearer ${token}`);
    expect(imp.status).toBe(200);
    expect(imp.body.refresh_token).toBeUndefined();

    const me = await request(app).get('/api/children/mine').set('Authorization', `Bearer ${imp.body.access_token}`);
    expect(me.status).toBe(200); // parent-only route works under the impersonated token

    const log = await request(app).get('/api/admin/audit-log').set('Authorization', `Bearer ${token}`);
    expect(log.body.entries[0]).toMatchObject({ action: 'user.impersonate', target_id: parent.body.user.id });
  });

  it('refuses to impersonate another super admin, a suspended user, or a missing user', async () => {
    const { token } = await adminToken();
    const other = await createSuperAdmin();
    expect((await request(app).post(`/api/admin/users/${other.id}/impersonate`).set('Authorization', `Bearer ${token}`)).status).toBe(403);

    const { res: parent } = await signupParent(app);
    await request(app).post(`/api/admin/users/${parent.body.user.id}/suspend`).set('Authorization', `Bearer ${token}`);
    expect((await request(app).post(`/api/admin/users/${parent.body.user.id}/impersonate`).set('Authorization', `Bearer ${token}`)).status).toBe(403);

    expect((await request(app).post('/api/admin/users/nope/impersonate').set('Authorization', `Bearer ${token}`)).status).toBe(404);
  });

  it('is super_admin only', async () => {
    const { res: parent } = await signupParent(app);
    const { res: other } = await signupParent(app);
    const res = await request(app).post(`/api/admin/users/${other.body.user.id}/impersonate`).set('Authorization', `Bearer ${parent.body.access_token}`);
    expect(res.status).toBe(403);
  });
});
