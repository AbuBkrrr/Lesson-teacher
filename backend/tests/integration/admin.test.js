const request = require('supertest');
const { getApp, signupParent, signupSchoolAdmin, createSuperAdmin } = require('../helpers');

const app = getApp();

async function loginAs(email, password) {
  const res = await request(app).post('/api/auth/login').send({ identifier: email, password });
  return res.body.access_token;
}

describe('admin', () => {
  it('lists users and can suspend/reactivate them', async () => {
    const { res: parent } = await signupParent(app, { email: 'suspendme@example.com' });
    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);

    const suspend = await request(app).post(`/api/admin/users/${parent.body.user.id}/suspend`).set('Authorization', `Bearer ${adminToken}`);
    expect(suspend.status).toBe(200);

    const loginAttempt = await request(app).post('/api/auth/login').send({ identifier: 'suspendme@example.com', password: 'TestPass123' });
    expect(loginAttempt.status).toBe(403);

    const reactivate = await request(app).post(`/api/admin/users/${parent.body.user.id}/reactivate`).set('Authorization', `Bearer ${adminToken}`);
    expect(reactivate.status).toBe(200);

    const loginAfter = await request(app).post('/api/auth/login').send({ identifier: 'suspendme@example.com', password: 'TestPass123' });
    expect(loginAfter.status).toBe(200);
  });

  it('gets and updates the platform commission setting', async () => {
    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);

    const initial = await request(app).get('/api/admin/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(initial.body.commission_percent).toBe(15);

    const updated = await request(app).patch('/api/admin/settings').set('Authorization', `Bearer ${adminToken}`).send({ commission_percent: 20 });
    expect(updated.status).toBe(200);
    expect(updated.body.commission_percent).toBe(20);
  });

  it('rejects an out-of-range commission value', async () => {
    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);
    const res = await request(app).patch('/api/admin/settings').set('Authorization', `Bearer ${adminToken}`).send({ commission_percent: 150 });
    expect(res.status).toBe(400);
  });

  it('non-admin roles cannot access admin endpoints', async () => {
    const { res: parent } = await signupParent(app, { email: 'notanadmin@example.com' });
    const res = await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${parent.body.access_token}`);
    expect(res.status).toBe(403);
  });

  it('rejects requests with no auth token at all', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(401);
  });
});

describe('schools', () => {
  it('school_admin can view and update their own school profile', async () => {
    const { res: schoolAdmin } = await signupSchoolAdmin(app, { email: 'schooladmin1@example.com', school_name: 'Original Name' });
    const token = schoolAdmin.body.access_token;

    const mine = await request(app).get('/api/schools/me').set('Authorization', `Bearer ${token}`);
    expect(mine.body.school.name).toBe('Original Name');
    expect(mine.body.school.join_code).toMatch(/^SCH-/);

    const updated = await request(app).patch('/api/schools/me').set('Authorization', `Bearer ${token}`).send({ name: 'Updated Name' });
    expect(updated.body.school.name).toBe('Updated Name');
  });

  it('school_admin can look up a parent by email and add their child to the roster', async () => {
    const { res: schoolAdmin } = await signupSchoolAdmin(app, { email: 'schooladmin2@example.com', school_name: 'Roster School' });
    const schoolToken = schoolAdmin.body.access_token;

    await signupParent(app, { email: 'rosterparent@example.com' });

    const lookup = await request(app).get('/api/schools/me/parent-lookup?identifier=rosterparent@example.com').set('Authorization', `Bearer ${schoolToken}`);
    expect(lookup.status).toBe(200);
    expect(lookup.body.parent.email).toBe('rosterparent@example.com');

    const addChild = await request(app).post('/api/schools/me/children').set('Authorization', `Bearer ${schoolToken}`).send({
      parent_id: lookup.body.parent.id, full_name: 'Roster Kid', grade_level: 'Primary 3',
    });
    expect(addChild.status).toBe(201);

    const roster = await request(app).get('/api/schools/me/children').set('Authorization', `Bearer ${schoolToken}`);
    expect(roster.body.children.some((c) => c.full_name === 'Roster Kid')).toBe(true);
  });

  it('parent self-signup with a valid school join code attaches them to that school', async () => {
    const { res: schoolAdmin } = await signupSchoolAdmin(app, { email: 'schooladmin3@example.com', school_name: 'Joinable School' });
    const joinCode = (await request(app).get('/api/schools/me').set('Authorization', `Bearer ${schoolAdmin.body.access_token}`)).body.school.join_code;

    const { res: parent } = await signupParent(app, { email: 'joiningparent@example.com', school_join_code: joinCode });
    expect(parent.status).toBe(201);
    expect(parent.body.user.school_id).toBe(schoolAdmin.body.user.school_id);
  });

  it('signup with an invalid join code is rejected', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      role: 'parent', full_name: 'X', email: 'badjoincode@example.com', password: 'TestPass123', school_join_code: 'SCH-NOTREAL1',
    });
    expect(res.status).toBe(400);
  });
});
