const request = require('supertest');
const { getApp, signupParent, signupTutor, signupSchoolAdmin, createSuperAdmin } = require('../helpers');

const app = getApp();

async function loginAs(email, password) {
  const res = await request(app).post('/api/auth/login').send({ identifier: email, password });
  return res.body.access_token;
}

async function createPlan(adminToken, overrides = {}) {
  const res = await request(app).post('/api/subscriptions/plans').set('Authorization', `Bearer ${adminToken}`).send({
    code: `plan_${Date.now()}_${Math.random()}`,
    name: 'Parent Plus',
    audience: 'parent',
    price: 2000,
    currency: 'NGN',
    interval: 'monthly',
    benefits: ['Priority booking', 'Unlimited messaging'],
    booking_discount_percent: 5,
    ...overrides,
  });
  return res.body.plan;
}

describe('subscription tiers (parent + B2B school)', () => {
  it('super_admin creates a parent plan, a parent subscribes, and mock-completes it', async () => {
    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);
    const plan = await createPlan(adminToken);

    const { res: parentRes } = await signupParent(app, { email: 'subparent1@example.com' });
    const parentToken = parentRes.body.access_token;

    const subscribe = await request(app).post('/api/subscriptions/subscribe').set('Authorization', `Bearer ${parentToken}`).send({ plan_id: plan.id });
    expect(subscribe.status).toBe(201);
    expect(subscribe.body.reference).toBeTruthy();

    const complete = await request(app).post('/api/subscriptions/mock/complete').send({ reference: subscribe.body.reference });
    expect(complete.status).toBe(200);
    expect(complete.body.subscription.status).toBe('active');

    const mine = await request(app).get('/api/subscriptions/mine').set('Authorization', `Bearer ${parentToken}`);
    expect(mine.body.subscriptions.length).toBe(1);
    expect(mine.body.subscriptions[0].status).toBe('active');
  });

  it('a tutor cannot subscribe to a parent plan', async () => {
    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);
    const plan = await createPlan(adminToken);

    const { res: tutorRes } = await signupTutor(app, { email: 'subtutor1@example.com' });
    const res = await request(app).post('/api/subscriptions/subscribe').set('Authorization', `Bearer ${tutorRes.body.access_token}`).send({ plan_id: plan.id });
    expect(res.status).toBe(403);
  });

  it('a school_admin can subscribe their school to a B2B plan', async () => {
    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);
    const schoolPlan = await createPlan(adminToken, { code: `school_plan_${Date.now()}`, name: 'School Standard', audience: 'school', price: 50000 });

    const { res: schoolAdminRes } = await signupSchoolAdmin(app, { email: 'subschooladmin1@example.com' });
    const token = schoolAdminRes.body.access_token;

    const subscribe = await request(app).post('/api/subscriptions/subscribe').set('Authorization', `Bearer ${token}`).send({ plan_id: schoolPlan.id });
    expect(subscribe.status).toBe(201);

    await request(app).post('/api/subscriptions/mock/complete').send({ reference: subscribe.body.reference });
    const mine = await request(app).get('/api/subscriptions/mine').set('Authorization', `Bearer ${token}`);
    expect(mine.body.subscriptions.length).toBe(1);
  });

  it('a parent can cancel their own subscription', async () => {
    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);
    const plan = await createPlan(adminToken);

    const { res: parentRes } = await signupParent(app, { email: 'subparent2@example.com' });
    const parentToken = parentRes.body.access_token;
    const subscribe = await request(app).post('/api/subscriptions/subscribe').set('Authorization', `Bearer ${parentToken}`).send({ plan_id: plan.id });

    const cancel = await request(app).post(`/api/subscriptions/${subscribe.body.subscription_id}/cancel`).set('Authorization', `Bearer ${parentToken}`);
    expect(cancel.status).toBe(200);

    const mine = await request(app).get('/api/subscriptions/mine').set('Authorization', `Bearer ${parentToken}`);
    expect(mine.body.subscriptions[0].status).toBe('cancelled');
  });

  it('only super_admin can create a plan', async () => {
    const { res: parentRes } = await signupParent(app, { email: 'subparent3@example.com' });
    const res = await request(app).post('/api/subscriptions/plans').set('Authorization', `Bearer ${parentRes.body.access_token}`).send({ code: 'x', name: 'x', audience: 'parent', price: 100 });
    expect(res.status).toBe(403);
  });
});
