const request = require('supertest');
const { getApp, signupTutor, signupParent } = require('../helpers');

const app = getApp();

async function addSkill(adminToken, name) {
  const res = await request(app).post('/api/skills').set('Authorization', `Bearer ${adminToken}`).send({ name, category: 'academic', icon: '📘' });
  return res.body.skill;
}

describe('tutor list caching (Redis)', () => {
  it('serves a cached result for an identical query, then reflects reality once the short TTL expires', async () => {
    const { createSuperAdmin } = require('../helpers');
    const admin = await createSuperAdmin();
    const loginRes = await request(app).post('/api/auth/login').send({ identifier: admin.email, password: admin.password });
    const adminToken = loginRes.body.access_token;
    const skill = await addSkill(adminToken, `CacheTest-${Date.now()}`);

    const { res: parent } = await signupParent(app, { email: `cache-parent-${Date.now()}@example.com` });
    const parentToken = parent.body.access_token;

    const { res: tutor1 } = await signupTutor(app, { email: `cache-tutor1-${Date.now()}@example.com` });
    await request(app).post('/api/skills/mine').set('Authorization', `Bearer ${tutor1.body.access_token}`).send({ skill_id: skill.id });

    // First request populates the cache.
    const first = await request(app).get('/api/tutors').query({ skill_id: skill.id }).set('Authorization', `Bearer ${parentToken}`);
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(1);

    // A second tutor joins the same skill — the cached response shouldn't see them yet.
    const { res: tutor2 } = await signupTutor(app, { email: `cache-tutor2-${Date.now()}@example.com` });
    await request(app).post('/api/skills/mine').set('Authorization', `Bearer ${tutor2.body.access_token}`).send({ skill_id: skill.id });

    const second = await request(app).get('/api/tutors').query({ skill_id: skill.id }).set('Authorization', `Bearer ${parentToken}`);
    expect(second.body.total).toBe(1); // still cached (TUTOR_LIST_CACHE_TTL_SECONDS=1 in .env.test)

    // Wait out the TTL — the next request should recompute and see both tutors.
    await new Promise((r) => setTimeout(r, 1200));
    const third = await request(app).get('/api/tutors').query({ skill_id: skill.id }).set('Authorization', `Bearer ${parentToken}`);
    expect(third.body.total).toBe(2);
  });
});
