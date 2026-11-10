const request = require('supertest');
const { getApp, signupParent, signupTutor, signupAdultStudent, createSuperAdmin, verifyUser, unique } = require('../helpers');

const app = getApp();

describe('adult student signup', () => {
  it('rejects signup under 18', async () => {
    const underage = new Date();
    underage.setFullYear(underage.getFullYear() - 17);
    const { res } = await signupAdultStudent(app, {
      email: `${unique('minor')}@example.com`,
      date_of_birth: underage.toISOString().slice(0, 10),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/18/);
  });

  it('rejects signup with no date_of_birth', async () => {
    const { res } = await signupAdultStudent(app, { email: `${unique('nodob')}@example.com`, date_of_birth: undefined });
    expect(res.status).toBe(400);
  });

  it('allows a self-sufficient signup at 18+ with no parent involved', async () => {
    const { res } = await signupAdultStudent(app, { email: `${unique('adult')}@example.com` });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('adult_student');
    expect(res.body.access_token).toBeTruthy();
  });
});

describe('identity verification hard gate', () => {
  it('blocks booking creation until a super_admin approves the ID', async () => {
    const { res: tutorRes } = await signupTutor(app, { email: `${unique('kyctutor')}@example.com` });
    await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${tutorRes.body.access_token}`)
      .send({ hourly_rate: 4000, currency: 'NGN', subjects: [] });

    const { res: parentRes } = await signupParent(app, { email: `${unique('kycparent')}@example.com` });
    const blocked = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .send({ tutor_id: tutorRes.body.user.id });
    expect(blocked.status).toBe(403);

    await verifyUser(parentRes.body.user.id);
    const allowed = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .send({ tutor_id: tutorRes.body.user.id });
    expect(allowed.status).toBe(201);
  });

  it('super_admin approve/reject flow updates id_verification_status', async () => {
    const admin = await createSuperAdmin();
    const adminLogin = await request(app).post('/api/auth/login').send({ identifier: admin.email, password: admin.password });
    const adminToken = adminLogin.body.access_token;

    const { res: parentRes } = await signupParent(app, { email: `${unique('reviewparent')}@example.com` });

    const upload = await request(app).post('/api/kyc/document').set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .field('document_type', 'national_id')
      .attach('file', Buffer.from('fake-id-bytes'), 'id.jpg');
    expect(upload.status).toBe(201);
    expect(upload.body.id_verification_status).toBe('pending');

    const pending = await request(app).get('/api/kyc/pending').set('Authorization', `Bearer ${adminToken}`);
    expect(pending.status).toBe(200);
    expect(pending.body.users.some((u) => u.id === parentRes.body.user.id)).toBe(true);

    const rejected = await request(app).post(`/api/kyc/${parentRes.body.user.id}/reject`).set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Blurry photo' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.id_verification_status).toBe('rejected');

    const approved = await request(app).post(`/api/kyc/${parentRes.body.user.id}/approve`).set('Authorization', `Bearer ${adminToken}`);
    expect(approved.status).toBe(200);
    expect(approved.body.id_verification_status).toBe('verified');

    const me = await request(app).get('/api/kyc/me').set('Authorization', `Bearer ${parentRes.body.access_token}`);
    expect(me.body.id_verification_status).toBe('verified');
  });

  it('rejects a non-admin trying to approve verification', async () => {
    const { res: parentRes } = await signupParent(app, { email: `${unique('noadminparent')}@example.com` });
    const { res: otherParentRes } = await signupParent(app, { email: `${unique('otherparent')}@example.com` });
    const res = await request(app).post(`/api/kyc/${otherParentRes.body.user.id}/approve`)
      .set('Authorization', `Bearer ${parentRes.body.access_token}`);
    expect(res.status).toBe(403);
  });
});
