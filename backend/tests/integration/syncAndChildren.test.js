const request = require('supertest');
const { getApp, signupParent } = require('../helpers');

const app = getApp();

describe('children CRUD', () => {
  it('a parent can create, update, and remove their own child', async () => {
    const { res: parent } = await signupParent(app, { email: 'crudparent@example.com' });
    const token = parent.body.access_token;

    const create = await request(app).post('/api/children').set('Authorization', `Bearer ${token}`).send({ full_name: 'Kid One', grade_level: 'Primary 2' });
    expect(create.status).toBe(201);
    const childId = create.body.child.id;

    const update = await request(app).patch(`/api/children/${childId}`).set('Authorization', `Bearer ${token}`).send({ grade_level: 'Primary 3' });
    expect(update.status).toBe(200);
    expect(update.body.child.grade_level).toBe('Primary 3');

    const list = await request(app).get('/api/children/mine').set('Authorization', `Bearer ${token}`);
    expect(list.body.children.length).toBe(1);

    const remove = await request(app).delete(`/api/children/${childId}`).set('Authorization', `Bearer ${token}`);
    expect(remove.status).toBe(200);

    const listAfter = await request(app).get('/api/children/mine').set('Authorization', `Bearer ${token}`);
    expect(listAfter.body.children.length).toBe(0);
  });

  it("a parent cannot update or remove another parent's child", async () => {
    const { res: owner } = await signupParent(app, { email: 'realowner@example.com' });
    const { res: intruder } = await signupParent(app, { email: 'intruder@example.com' });

    const create = await request(app).post('/api/children').set('Authorization', `Bearer ${owner.body.access_token}`).send({ full_name: 'Protected Kid' });
    const childId = create.body.child.id;

    const update = await request(app).patch(`/api/children/${childId}`).set('Authorization', `Bearer ${intruder.body.access_token}`).send({ full_name: 'Hacked Name' });
    expect(update.status).toBe(404);

    const remove = await request(app).delete(`/api/children/${childId}`).set('Authorization', `Bearer ${intruder.body.access_token}`);
    expect(remove.status).toBe(404);
  });

  it('rejects creating a child without a full_name', async () => {
    const { res: parent } = await signupParent(app, { email: 'nonamekid@example.com' });
    const res = await request(app).post('/api/children').set('Authorization', `Bearer ${parent.body.access_token}`).send({});
    expect(res.status).toBe(400);
  });
});

describe('mobile offline sync', () => {
  it('pull returns records scoped to the requesting user, since a given timestamp', async () => {
    const { res: parent } = await signupParent(app, { email: 'syncparent@example.com' });
    const token = parent.body.access_token;

    await request(app).post('/api/children').set('Authorization', `Bearer ${token}`).send({ full_name: 'Synced Kid' });

    const pull = await request(app).get('/api/sync/pull?since=1970-01-01T00:00:00.000Z').set('Authorization', `Bearer ${token}`);
    expect(pull.status).toBe(200);
    expect(pull.body.server_time).toBeTruthy();
    expect(pull.body.tables.children.some((c) => c.full_name === 'Synced Kid')).toBe(true);
    expect(pull.body.tables.users.every((u) => !('password_hash' in u))).toBe(true);
  });

  it('a subsequent pull using the returned server_time excludes already-seen records', async () => {
    const { res: parent } = await signupParent(app, { email: 'syncparent2@example.com' });
    const token = parent.body.access_token;

    const firstPull = await request(app).get('/api/sync/pull?since=1970-01-01T00:00:00.000Z').set('Authorization', `Bearer ${token}`);
    const checkpoint = firstPull.body.server_time;

    await request(app).post('/api/children').set('Authorization', `Bearer ${token}`).send({ full_name: 'Later Kid' });

    const secondPull = await request(app).get(`/api/sync/pull?since=${encodeURIComponent(checkpoint)}`).set('Authorization', `Bearer ${token}`);
    expect(secondPull.body.tables.children.length).toBe(1);
    expect(secondPull.body.tables.children[0].full_name).toBe('Later Kid');
  });

  it('push creates an offline-authored record and returns the server-confirmed version', async () => {
    const { res: parent } = await signupParent(app, { email: 'syncpush@example.com' });
    const token = parent.body.access_token;
    const parentId = parent.body.user.id;
    const offlineId = '11111111-1111-1111-1111-111111111111';

    const push = await request(app).post('/api/sync/push').set('Authorization', `Bearer ${token}`).send({
      changes: [{ table: 'children', operation: 'create', record: { id: offlineId, parent_id: parentId, full_name: 'Offline Kid', grade_level: 'Primary 1' } }],
    });
    expect(push.status).toBe(200);
    expect(push.body.applied.length).toBe(1);
    expect(push.body.applied[0].server_record.full_name).toBe('Offline Kid');

    const list = await request(app).get('/api/children/mine').set('Authorization', `Bearer ${token}`);
    expect(list.body.children.some((c) => c.id === offlineId)).toBe(true);
  });

  it('push rejects a change to a record the user does not own', async () => {
    const { res: owner } = await signupParent(app, { email: 'syncowner@example.com' });
    const { res: attacker } = await signupParent(app, { email: 'syncattacker@example.com' });

    const push = await request(app).post('/api/sync/push').set('Authorization', `Bearer ${attacker.body.access_token}`).send({
      changes: [{ table: 'children', operation: 'create', record: { id: '22222222-2222-2222-2222-222222222222', parent_id: owner.body.user.id, full_name: 'Injected Kid' } }],
    });
    expect(push.status).toBe(200);
    expect(push.body.rejected.length).toBe(1);
    expect(push.body.applied.length).toBe(0);
  });
});
