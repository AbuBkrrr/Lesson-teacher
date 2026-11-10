const request = require('supertest');
const { getApp, signupParent, signupSchoolAdmin } = require('../helpers');

const app = getApp();

describe('school admin: students', () => {
  it('parent-lookup returns the parent\'s existing children so a school admin can link one instead of duplicating it', async () => {
    const { res: parentRes } = await signupParent(app, { email: `lookupchild_${Date.now()}@example.com` });
    const parentToken = parentRes.body.access_token;
    await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`)
      .send({ full_name: 'Existing Kid', grade_level: 'Primary 2' });

    const { res: schoolRes } = await signupSchoolAdmin(app);
    const schoolToken = schoolRes.body.access_token;

    const lookup = await request(app).get('/api/schools/me/parent-lookup')
      .query({ identifier: parentRes.body.user.email })
      .set('Authorization', `Bearer ${schoolToken}`);

    expect(lookup.status).toBe(200);
    expect(lookup.body.parent.id).toBe(parentRes.body.user.id);
    expect(lookup.body.children).toHaveLength(1);
    expect(lookup.body.children[0].full_name).toBe('Existing Kid');
    expect(lookup.body.children[0].school_id).toBeNull();
  });

  it('links an existing child to the school instead of creating a duplicate record', async () => {
    const { res: parentRes } = await signupParent(app, { email: `linkchild_${Date.now()}@example.com` });
    const parentToken = parentRes.body.access_token;
    const childRes = await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`)
      .send({ full_name: 'Linkable Kid', grade_level: 'Primary 3' });
    const childId = childRes.body.child.id;

    const { res: schoolRes } = await signupSchoolAdmin(app);
    const schoolToken = schoolRes.body.access_token;

    const link = await request(app).post('/api/schools/me/children').set('Authorization', `Bearer ${schoolToken}`)
      .send({ child_id: childId });
    expect(link.status).toBe(200);
    expect(link.body.child.id).toBe(childId); // same record, not a new one
    expect(link.body.child.full_name).toBe('Linkable Kid');
    expect(link.body.child.school_id).toBe(schoolRes.body.user.school_id);

    // The roster now shows exactly this one record, not a duplicate.
    const roster = await request(app).get('/api/schools/me/children').set('Authorization', `Bearer ${schoolToken}`);
    expect(roster.body.children).toHaveLength(1);
    expect(roster.body.children[0].id).toBe(childId);
  });

  it('refuses to link a child already claimed by a different school', async () => {
    const { res: parentRes } = await signupParent(app, { email: `contested_${Date.now()}@example.com` });
    const parentToken = parentRes.body.access_token;
    const childRes = await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`)
      .send({ full_name: 'Contested Kid' });
    const childId = childRes.body.child.id;

    const { res: schoolARes } = await signupSchoolAdmin(app);
    await request(app).post('/api/schools/me/children').set('Authorization', `Bearer ${schoolARes.body.access_token}`)
      .send({ child_id: childId });

    const { res: schoolBRes } = await signupSchoolAdmin(app);
    const stolen = await request(app).post('/api/schools/me/children').set('Authorization', `Bearer ${schoolBRes.body.access_token}`)
      .send({ child_id: childId });
    expect(stolen.status).toBe(400);
  });

  it('still supports creating a brand-new child for a parent who has none yet', async () => {
    const { res: parentRes } = await signupParent(app, { email: `newchild_${Date.now()}@example.com` });
    const { res: schoolRes } = await signupSchoolAdmin(app);

    const created = await request(app).post('/api/schools/me/children').set('Authorization', `Bearer ${schoolRes.body.access_token}`)
      .send({ parent_id: parentRes.body.user.id, full_name: 'Brand New Kid', grade_level: 'Primary 1' });
    expect(created.status).toBe(201);
    expect(created.body.child.full_name).toBe('Brand New Kid');
    expect(created.body.child.school_id).toBe(schoolRes.body.user.school_id);
  });

  it('rejects a request with neither child_id nor parent_id+full_name', async () => {
    const { res: schoolRes } = await signupSchoolAdmin(app);
    const res = await request(app).post('/api/schools/me/children').set('Authorization', `Bearer ${schoolRes.body.access_token}`)
      .send({ grade_level: 'Primary 1' });
    expect(res.status).toBe(400);
  });
});
