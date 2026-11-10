const request = require('supertest');
const { getApp, signupParent, signupTutor, signupSchoolAdmin, createSuperAdmin, verifyUser } = require('../helpers');

const app = getApp();

async function loginAs(email, password) {
  const res = await request(app).post('/api/auth/login').send({ identifier: email, password });
  return res.body.access_token;
}

async function setupConfirmedBooking(parentEmail, tutorEmail) {
  const { res: tutorRes } = await signupTutor(app, { email: tutorEmail });
  const tutorToken = tutorRes.body.access_token;
  const tutorId = tutorRes.body.user.id;
  await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${tutorToken}`).send({ hourly_rate: 4000, currency: 'NGN', subjects: [] });

  const { res: parentRes } = await signupParent(app, { email: parentEmail });
  const parentToken = parentRes.body.access_token;
  await verifyUser(tutorId);
  await verifyUser(parentRes.body.user.id);

  const child = await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`).send({ full_name: 'Assignment Kid' });
  const childId = child.body.child.id;

  const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorId, child_id: childId });
  await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutorToken}`).send({ status: 'confirmed' });

  return { tutorToken, tutorId, parentToken, parentId: parentRes.body.user.id, childId };
}

describe('curriculum library', () => {
  it('super_admin can create a global curriculum unit, visible to everyone', async () => {
    const admin = await createSuperAdmin();
    const adminToken = await loginAs(admin.email, admin.password);

    const create = await request(app).post('/api/curriculum').set('Authorization', `Bearer ${adminToken}`).send({ title: 'Global Fractions Unit', grade_level: 'Primary 4' });
    expect(create.status).toBe(201);
    expect(create.body.curriculum_unit.school_id).toBeNull();

    const { res: tutor } = await signupTutor(app, { email: 'curricultutor@example.com' });
    const list = await request(app).get('/api/curriculum').set('Authorization', `Bearer ${tutor.body.access_token}`);
    expect(list.body.curriculum_units.some((u) => u.title === 'Global Fractions Unit')).toBe(true);
  });

  it("school_admin can create a school-specific unit, and a non-affiliated tutor cannot see it", async () => {
    const { res: schoolAdmin } = await signupSchoolAdmin(app, { email: 'curriculumschool@example.com', school_name: 'Curriculum School' });
    const schoolToken = schoolAdmin.body.access_token;

    const create = await request(app).post('/api/curriculum').set('Authorization', `Bearer ${schoolToken}`).send({ title: 'School-Only Unit', grade_level: 'Primary 5' });
    expect(create.status).toBe(201);
    expect(create.body.curriculum_unit.school_id).toBe(schoolAdmin.body.user.school_id);

    const { res: unaffiliatedTutor } = await signupTutor(app, { email: 'unaffiliated@example.com' });
    const list = await request(app).get('/api/curriculum').set('Authorization', `Bearer ${unaffiliatedTutor.body.access_token}`);
    expect(list.body.curriculum_units.some((u) => u.title === 'School-Only Unit')).toBe(false);
  });

  it('a tutor with a confirmed booking to a child at that school CAN see the school curriculum', async () => {
    const { res: schoolAdmin } = await signupSchoolAdmin(app, { email: 'visibleschool@example.com', school_name: 'Visible School' });
    const schoolToken = schoolAdmin.body.access_token;
    await request(app).post('/api/curriculum').set('Authorization', `Bearer ${schoolToken}`).send({ title: 'Visible School Unit' });

    const { res: parent } = await signupParent(app, { email: 'schoolparent@example.com' });

    await request(app).post('/api/schools/me/children').set('Authorization', `Bearer ${schoolToken}`).send({ parent_id: parent.body.user.id, full_name: 'Rostered Kid' });
    const roster = await request(app).get('/api/schools/me/children').set('Authorization', `Bearer ${schoolToken}`);
    const rosteredChildId = roster.body.children.find((c) => c.full_name === 'Rostered Kid').id;

    const { res: tutor } = await signupTutor(app, { email: 'schooltutor@example.com' });
    await verifyUser(tutor.body.user.id);
    await verifyUser(parent.body.user.id);
    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parent.body.access_token}`).send({ tutor_id: tutor.body.user.id, child_id: rosteredChildId });
    await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`).set('Authorization', `Bearer ${tutor.body.access_token}`).send({ status: 'confirmed' });

    const list = await request(app).get('/api/curriculum').set('Authorization', `Bearer ${tutor.body.access_token}`);
    expect(list.body.curriculum_units.some((u) => u.title === 'Visible School Unit')).toBe(true);
  });

  it("a school_admin cannot edit another school's curriculum unit", async () => {
    const { res: schoolA } = await signupSchoolAdmin(app, { email: 'schoolaadmin@example.com', school_name: 'School A' });
    const { res: schoolB } = await signupSchoolAdmin(app, { email: 'schoolbadmin@example.com', school_name: 'School B' });

    const create = await request(app).post('/api/curriculum').set('Authorization', `Bearer ${schoolA.body.access_token}`).send({ title: 'School A Unit' });
    const res = await request(app)
      .patch(`/api/curriculum/${create.body.curriculum_unit.id}`)
      .set('Authorization', `Bearer ${schoolB.body.access_token}`)
      .send({ title: 'Hijacked Title' });
    expect(res.status).toBe(403);
  });
});

describe('lesson materials', () => {
  it('a tutor can upload a file, list their own materials, and delete one', async () => {
    const { res: tutor } = await signupTutor(app, { email: 'uploadtutor@example.com' });
    const token = tutor.body.access_token;

    const upload = await request(app)
      .post('/api/lesson-materials')
      .set('Authorization', `Bearer ${token}`)
      .field('title', 'Fractions Worksheet')
      .field('description', 'Practice worksheet for week 3')
      .attach('file', Buffer.from('%PDF-1.4 fake pdf content'), 'worksheet.pdf');

    expect(upload.status).toBe(201);
    expect(upload.body.material.file_type).toBe('pdf');
    expect(upload.body.material.file_url).toMatch(/^http/);

    const mine = await request(app).get('/api/lesson-materials/mine').set('Authorization', `Bearer ${token}`);
    expect(mine.body.materials.length).toBe(1);

    const del = await request(app).delete(`/api/lesson-materials/${upload.body.material.id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const mineAfter = await request(app).get('/api/lesson-materials/mine').set('Authorization', `Bearer ${token}`);
    expect(mineAfter.body.materials.length).toBe(0);
  });

  it('rejects an upload with no file', async () => {
    const { res: tutor } = await signupTutor(app, { email: 'nofileupload@example.com' });
    const res = await request(app).post('/api/lesson-materials').set('Authorization', `Bearer ${tutor.body.access_token}`).field('title', 'No File');
    expect(res.status).toBe(400);
  });

  it("a parent/child WITHOUT a confirmed booking cannot view a tutor's materials", async () => {
    const { res: tutor } = await signupTutor(app, { email: 'privatetutor@example.com' });
    await request(app).post('/api/lesson-materials').set('Authorization', `Bearer ${tutor.body.access_token}`).field('title', 'Private').attach('file', Buffer.from('x'), 'x.pdf');

    const { res: parent } = await signupParent(app, { email: 'nobookingviewer@example.com' });
    const res = await request(app).get(`/api/lesson-materials/tutor/${tutor.body.user.id}`).set('Authorization', `Bearer ${parent.body.access_token}`);
    expect(res.status).toBe(403);
  });

  it("a parent WITH a confirmed booking can view the tutor's materials", async () => {
    const { tutorToken, tutorId, parentToken } = await setupConfirmedBooking('materialsparent@example.com', 'materialstutor@example.com');
    await request(app).post('/api/lesson-materials').set('Authorization', `Bearer ${tutorToken}`).field('title', 'Shared Material').attach('file', Buffer.from('x'), 'x.pdf');

    const res = await request(app).get(`/api/lesson-materials/tutor/${tutorId}`).set('Authorization', `Bearer ${parentToken}`);
    expect(res.status).toBe(200);
    expect(res.body.materials.length).toBe(1);
  });
});

describe('assignments', () => {
  it('runs the full lifecycle: assign -> child submits -> tutor grades', async () => {
    const { tutorToken, parentToken, childId } = await setupConfirmedBooking('assignparent@example.com', 'assigntutor@example.com');

    const create = await request(app).post('/api/assignments').set('Authorization', `Bearer ${tutorToken}`).send({ child_id: childId, title: 'Fractions Homework', instructions: 'Complete pages 1-3' });
    expect(create.status).toBe(201);
    expect(create.body.assignment.status).toBe('assigned');
    const assignmentId = create.body.assignment.id;

    const invite = await request(app).post(`/api/children/${childId}/invite`).set('Authorization', `Bearer ${parentToken}`);
    const childSession = await request(app).post('/api/auth/child/redeem-invite').send({ code: invite.body.code, username: 'assignmentchild', password: 'ChildPass123' });
    const childToken = childSession.body.access_token;

    const submit = await request(app).patch(`/api/assignments/${assignmentId}/submit`).set('Authorization', `Bearer ${childToken}`).send({ content: 'Here is my completed homework.' });
    expect(submit.status).toBe(200);
    expect(submit.body.assignment.status).toBe('submitted');

    const grade = await request(app).patch(`/api/assignments/${assignmentId}/grade`).set('Authorization', `Bearer ${tutorToken}`).send({ grade: 'A', feedback: 'Excellent work!' });
    expect(grade.status).toBe(200);
    expect(grade.body.assignment.status).toBe('graded');
    expect(grade.body.assignment.grade).toBe('A');
  });

  it('a parent can submit on behalf of their child', async () => {
    const { tutorToken, parentToken, childId } = await setupConfirmedBooking('parentsubmit@example.com', 'parentsubmittutor@example.com');
    const create = await request(app).post('/api/assignments').set('Authorization', `Bearer ${tutorToken}`).send({ child_id: childId, title: 'Reading Log' });

    const submit = await request(app).patch(`/api/assignments/${create.body.assignment.id}/submit`).set('Authorization', `Bearer ${parentToken}`).send({ content: 'Submitted by parent' });
    expect(submit.status).toBe(200);
  });

  it('cannot create an assignment without a confirmed booking with that child', async () => {
    const { res: tutor } = await signupTutor(app, { email: 'noassigntutor@example.com' });
    const { res: parent } = await signupParent(app, { email: 'noassignparent@example.com' });
    const child = await request(app).post('/api/children').set('Authorization', `Bearer ${parent.body.access_token}`).send({ full_name: 'Unbooked Kid' });

    const res = await request(app).post('/api/assignments').set('Authorization', `Bearer ${tutor.body.access_token}`).send({ child_id: child.body.child.id, title: 'Should Fail' });
    expect(res.status).toBe(403);
  });

  it('cannot submit twice after grading, and cannot grade before submission', async () => {
    const { tutorToken, parentToken, childId } = await setupConfirmedBooking('lockparent@example.com', 'locktutor@example.com');
    const create = await request(app).post('/api/assignments').set('Authorization', `Bearer ${tutorToken}`).send({ child_id: childId, title: 'Lock Test' });

    const tooEarly = await request(app).patch(`/api/assignments/${create.body.assignment.id}/grade`).set('Authorization', `Bearer ${tutorToken}`).send({ grade: 'A' });
    expect(tooEarly.status).toBe(400);

    await request(app).patch(`/api/assignments/${create.body.assignment.id}/submit`).set('Authorization', `Bearer ${parentToken}`).send({ content: 'done' });
    await request(app).patch(`/api/assignments/${create.body.assignment.id}/grade`).set('Authorization', `Bearer ${tutorToken}`).send({ grade: 'B' });

    const resubmit = await request(app).patch(`/api/assignments/${create.body.assignment.id}/submit`).set('Authorization', `Bearer ${parentToken}`).send({ content: 'too late' });
    expect(resubmit.status).toBe(400);
  });
});
