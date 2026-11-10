const request = require('supertest');
const { getApp, signupTutor, signupParent, createSuperAdmin, verifyUser } = require('../helpers');

const app = getApp();

async function loginAs(email, password) {
  const res = await request(app).post('/api/auth/login').send({ identifier: email, password });
  return res.body.access_token;
}

describe('auditions', () => {
  it('refuses to mark an audition ready without a video link', async () => {
    const { res: t } = await signupTutor(app);
    const { res: p } = await signupParent(app);
    await verifyUser(p.body.user.id);
    await verifyUser(t.body.user.id);
    const a = await request(app).post('/api/auditions').set('Authorization', `Bearer ${p.body.access_token}`).send({ tutor_id: t.body.user.id });
    const res = await request(app).patch(`/api/auditions/${a.body.audition.id}/status`).set('Authorization', `Bearer ${t.body.access_token}`).send({ status: 'ready' });
    expect(res.status).toBe(400);
  });

  it('runs the full lifecycle: request -> tutor marks ready with video -> completed', async () => {
    const { res: tutor } = await signupTutor(app, { email: 'auditiontutor@example.com' });
    const { res: parent } = await signupParent(app, { email: 'auditionparent@example.com' });
    await verifyUser(tutor.body.user.id);
    await verifyUser(parent.body.user.id);

    const create = await request(app).post('/api/auditions').set('Authorization', `Bearer ${parent.body.access_token}`).send({ tutor_id: tutor.body.user.id });
    expect(create.status).toBe(201);
    expect(create.body.audition.status).toBe('pending');
    const auditionId = create.body.audition.id;

    const ready = await request(app)
      .patch(`/api/auditions/${auditionId}/status`)
      .set('Authorization', `Bearer ${tutor.body.access_token}`)
      .send({ status: 'ready', video_url: 'https://example.com/video.mp4' });
    expect(ready.status).toBe(200);
    expect(ready.body.audition.video_url).toBe('https://example.com/video.mp4');

    const completed = await request(app)
      .patch(`/api/auditions/${auditionId}/status`)
      .set('Authorization', `Bearer ${tutor.body.access_token}`)
      .send({ status: 'completed' });
    expect(completed.status).toBe(200);
    expect(completed.body.audition.status).toBe('completed');
  });

  it('a tutor can decline an audition request', async () => {
    const { res: tutor } = await signupTutor(app, { email: 'declinetutor@example.com' });
    const { res: parent } = await signupParent(app, { email: 'declineparent@example.com' });
    await verifyUser(tutor.body.user.id);
    await verifyUser(parent.body.user.id);

    const create = await request(app).post('/api/auditions').set('Authorization', `Bearer ${parent.body.access_token}`).send({ tutor_id: tutor.body.user.id });
    const decline = await request(app)
      .patch(`/api/auditions/${create.body.audition.id}/status`)
      .set('Authorization', `Bearer ${tutor.body.access_token}`)
      .send({ status: 'declined' });
    expect(decline.status).toBe(200);
  });

  it('only a parent can request an audition, not a tutor', async () => {
    const { res: tutorA } = await signupTutor(app, { email: 'tutora@example.com' });
    const { res: tutorB } = await signupTutor(app, { email: 'tutorb@example.com' });
    const res = await request(app).post('/api/auditions').set('Authorization', `Bearer ${tutorA.body.access_token}`).send({ tutor_id: tutorB.body.user.id });
    expect(res.status).toBe(403);
  });

  it('auditions/mine never leaks every audition platform-wide to a role it was not scoped for (regression)', async () => {
    const { res: tutor } = await signupTutor(app, { email: 'auditionleaktutor@example.com' });
    const { res: parent } = await signupParent(app, { email: 'auditionleakparent@example.com' });
    await verifyUser(parent.body.user.id);
    await request(app).post('/api/auditions').set('Authorization', `Bearer ${parent.body.access_token}`).send({ tutor_id: tutor.body.user.id });

    const schoolSignup = await request(app)
      .post('/api/auth/signup')
      .send({ role: 'school_admin', full_name: 'Audition Leak School', email: 'auditionleakschool@example.com', password: 'TestPass123', school_name: 'Audition Leak School' });
    const res = await request(app).get('/api/auditions/mine').set('Authorization', `Bearer ${schoolSignup.body.access_token}`);
    expect(res.status).toBe(403);
  });

  it('lists auditions scoped to parent or tutor respectively', async () => {
    const { res: tutor } = await signupTutor(app, { email: 'listtutor@example.com' });
    const { res: parent } = await signupParent(app, { email: 'listparent@example.com' });
    await verifyUser(parent.body.user.id);
    await request(app).post('/api/auditions').set('Authorization', `Bearer ${parent.body.access_token}`).send({ tutor_id: tutor.body.user.id });

    const parentList = await request(app).get('/api/auditions/mine').set('Authorization', `Bearer ${parent.body.access_token}`);
    expect(parentList.body.auditions.length).toBe(1);

    const tutorList = await request(app).get('/api/auditions/mine').set('Authorization', `Bearer ${tutor.body.access_token}`);
    expect(tutorList.body.auditions.length).toBe(1);
  });

  it('rejects an invalid status transition', async () => {
    const { res: tutor } = await signupTutor(app, { email: 'badtransition@example.com' });
    const { res: parent } = await signupParent(app, { email: 'badtransitionparent@example.com' });
    await verifyUser(tutor.body.user.id);
    await verifyUser(parent.body.user.id);
    const create = await request(app).post('/api/auditions').set('Authorization', `Bearer ${parent.body.access_token}`).send({ tutor_id: tutor.body.user.id });

    const res = await request(app)
      .patch(`/api/auditions/${create.body.audition.id}/status`)
      .set('Authorization', `Bearer ${tutor.body.access_token}`)
      .send({ status: 'completed' });
    expect(res.status).toBe(400);
  });
});

describe('admin stats', () => {
  it('reflects real counts of users, schools, and bookings', async () => {
    await signupParent(app, { email: 'statsparent@example.com' });
    const { res: tutor } = await signupTutor(app, { email: 'statstutor@example.com' });

    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);

    const stats = await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${adminToken}`);
    expect(stats.status).toBe(200);
    expect(typeof stats.body.total_schools).toBe('number');
    expect(typeof stats.body.total_bookings).toBe('number');
    const roleEntry = stats.body.users_by_role.find((r) => r.role === 'tutor');
    expect(typeof roleEntry.count).toBe('number');
    expect(roleEntry.count).toBeGreaterThanOrEqual(1);
  });

  it('lists and filters users by role', async () => {
    await signupTutor(app, { email: 'filtertutor@example.com' });
    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);

    const res = await request(app).get('/api/admin/users?role=tutor').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.users.every((u) => u.role === 'tutor')).toBe(true);
  });
});
