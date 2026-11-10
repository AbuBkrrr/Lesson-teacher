const request = require('supertest');
const { getApp, signupParent, signupTutor, createSuperAdmin } = require('../helpers');

const app = getApp();

async function loginAs(email, password) {
  const res = await request(app).post('/api/auth/login').send({ identifier: email, password });
  return res.body.access_token;
}

describe('referrals', () => {
  it('attributes a signup to an existing user via their referral code', async () => {
    const { res: referrer } = await signupParent(app, { email: 'referrer1@example.com' });
    const referralCode = referrer.body.referral_code;

    const { res: referred } = await signupParent(app, {
      email: 'referred1@example.com', referral_contact: referralCode,
    });
    expect(referred.status).toBe(201);

    const referrerToken = referrer.body.access_token;
    const mine = await request(app).get('/api/referrals/me').set('Authorization', `Bearer ${referrerToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.summary.total).toBe(1);
    expect(mine.body.referrals[0].status).toBe('pending');
  });

  it("attributes a signup via the referrer's email or phone, not just their code", async () => {
    const { res: referrer } = await signupParent(app, { email: 'referrer2@example.com', phone: '+2348022223333' });

    const { res: referred } = await signupTutor(app, {
      email: 'referred2@example.com', referral_contact: '+2348022223333',
    });
    expect(referred.status).toBe(201);

    const token = referrer.body.access_token;
    const mine = await request(app).get('/api/referrals/me').set('Authorization', `Bearer ${token}`);
    expect(mine.body.summary.total).toBe(1);
  });

  it('marks an unrecognized referral contact as unresolved, not silently dropped', async () => {
    const { res } = await signupParent(app, {
      email: 'unresolved1@example.com', referral_contact: 'nobody-real@nowhere.example',
    });
    expect(res.status).toBe(201);

    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);

    const unresolved = await request(app).get('/api/referrals/unresolved').set('Authorization', `Bearer ${adminToken}`);
    expect(unresolved.status).toBe(200);
    expect(unresolved.body.referrals.some((r) => r.marketer_identifier === 'nobody-real@nowhere.example')).toBe(true);
  });

  it('lets super_admin resolve an unresolved referral to a real user', async () => {
    const { res: newUser } = await signupParent(app, {
      email: 'unresolved2@example.com', referral_contact: 'ghost@nowhere.example',
    });
    const { res: actualReferrer } = await signupTutor(app, { email: 'actualreferrer@example.com' });

    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);

    const unresolvedList = await request(app).get('/api/referrals/unresolved').set('Authorization', `Bearer ${adminToken}`);
    const target = unresolvedList.body.referrals.find((r) => r.new_user_id === newUser.body.user.id);
    expect(target).toBeTruthy();

    const resolveRes = await request(app)
      .post(`/api/referrals/${target.id}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ marketer_user_id: actualReferrer.body.user.id });
    expect(resolveRes.status).toBe(200);

    const referrerToken = actualReferrer.body.access_token;
    const mine = await request(app).get('/api/referrals/me').set('Authorization', `Bearer ${referrerToken}`);
    expect(mine.body.summary.total).toBe(1);
  });

  it('non-admin cannot view the unresolved queue', async () => {
    const { res: parent } = await signupParent(app, { email: 'notadmin@example.com' });
    const res = await request(app).get('/api/referrals/unresolved').set('Authorization', `Bearer ${parent.body.access_token}`);
    expect(res.status).toBe(403);
  });
});
