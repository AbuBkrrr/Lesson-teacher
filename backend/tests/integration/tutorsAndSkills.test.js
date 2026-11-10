const request = require('supertest');
const { getApp, signupTutor, signupParent, createSuperAdmin } = require('../helpers');

const app = getApp();

async function loginAs(email, password) {
  const res = await request(app).post('/api/auth/login').send({ identifier: email, password });
  return res.body.access_token;
}

async function addSkill(adminToken, name, category = 'academic') {
  const res = await request(app).post('/api/skills').set('Authorization', `Bearer ${adminToken}`).send({ name, category, icon: '📘' });
  return res.body.skill;
}

describe('skills catalog', () => {
  it('super_admin can add and remove skills', async () => {
    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);

    const skill = await addSkill(adminToken, 'Test Subject Alpha');
    expect(skill.id).toBeTruthy();

    const list = await request(app).get('/api/skills');
    expect(list.body.skills.some((s) => s.id === skill.id)).toBe(true);

    const del = await request(app).delete(`/api/skills/${skill.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);

    const listAfter = await request(app).get('/api/skills');
    expect(listAfter.body.skills.some((s) => s.id === skill.id)).toBe(false);
  });

  it('non-admin cannot add a skill', async () => {
    const { res: tutor } = await signupTutor(app, { email: 'noadmin@example.com' });
    const res = await request(app).post('/api/skills').set('Authorization', `Bearer ${tutor.body.access_token}`).send({ name: 'X', category: 'academic' });
    expect(res.status).toBe(403);
  });

  it('a tutor can attach and detach a skill from their profile', async () => {
    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);
    const skill = await addSkill(adminToken, 'Test Subject Beta');

    const { res: tutor } = await signupTutor(app, { email: 'skilltutor@example.com' });
    const tutorToken = tutor.body.access_token;

    const attach = await request(app).post('/api/skills/mine').set('Authorization', `Bearer ${tutorToken}`).send({ skill_id: skill.id, proficiency: 'expert' });
    expect(attach.status).toBe(201);

    const mine = await request(app).get('/api/skills/mine').set('Authorization', `Bearer ${tutorToken}`);
    expect(mine.body.tutor_skills.some((s) => s.skill_id === skill.id)).toBe(true);

    const detach = await request(app).delete(`/api/skills/mine/${skill.id}`).set('Authorization', `Bearer ${tutorToken}`);
    expect(detach.status).toBe(200);

    const mineAfter = await request(app).get('/api/skills/mine').set('Authorization', `Bearer ${tutorToken}`);
    expect(mineAfter.body.tutor_skills.some((s) => s.skill_id === skill.id)).toBe(false);
  });
});

describe('tutor discovery', () => {
  it('filters tutors by skill_id and respects pagination', async () => {
    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);
    const mathSkill = await addSkill(adminToken, 'Discovery Maths');
    const artSkill = await addSkill(adminToken, 'Discovery Art', 'creative');

    const { res: mathTutor } = await signupTutor(app, { email: 'mathtutor@example.com' });
    await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${mathTutor.body.access_token}`).send({ hourly_rate: 4000, currency: 'NGN', subjects: [] });
    await request(app).post('/api/skills/mine').set('Authorization', `Bearer ${mathTutor.body.access_token}`).send({ skill_id: mathSkill.id });

    const { res: artTutor } = await signupTutor(app, { email: 'arttutor@example.com' });
    await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${artTutor.body.access_token}`).send({ hourly_rate: 6000, currency: 'NGN', subjects: [] });
    await request(app).post('/api/skills/mine').set('Authorization', `Bearer ${artTutor.body.access_token}`).send({ skill_id: artSkill.id });

    const { res: parent } = await signupParent(app, { email: 'discoveryparent@example.com' });
    const parentToken = parent.body.access_token;

    const filtered = await request(app).get(`/api/tutors?skill_id=${mathSkill.id}`).set('Authorization', `Bearer ${parentToken}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.tutors.map((t) => t.user_id)).toContain(mathTutor.body.user.id);
    expect(filtered.body.tutors.map((t) => t.user_id)).not.toContain(artTutor.body.user.id);

    const byRate = await request(app).get('/api/tutors?min_rate=5000').set('Authorization', `Bearer ${parentToken}`);
    expect(byRate.body.tutors.map((t) => t.user_id)).toContain(artTutor.body.user.id);
    expect(byRate.body.tutors.map((t) => t.user_id)).not.toContain(mathTutor.body.user.id);

    const paged = await request(app).get('/api/tutors?page=1&page_size=1').set('Authorization', `Bearer ${parentToken}`);
    expect(paged.body.tutors.length).toBe(1);
    expect(paged.body.page_size).toBe(1);
    expect(typeof paged.body.total).toBe('number');
  });

  it('caps page_size at the server-enforced maximum', async () => {
    const { res: parent } = await signupParent(app, { email: 'pagecap@example.com' });
    const res = await request(app).get('/api/tutors?page_size=9999').set('Authorization', `Bearer ${parent.body.access_token}`);
    expect(res.body.page_size).toBeLessThanOrEqual(50);
  });
});
