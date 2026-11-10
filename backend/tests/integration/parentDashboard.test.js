const request = require('supertest');
const { getApp, signupParent, signupTutor, verifyUser } = require('../helpers');

const app = getApp();

async function setupTutorWithRate(email, rate = 5000) {
  const { res } = await signupTutor(app, { email });
  const token = res.body.access_token;
  await verifyUser(res.body.user.id);
  await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${token}`).send({ hourly_rate: rate, currency: 'NGN' });
  return { id: res.body.user.id, token };
}

describe('GET /parents/me/dashboard', () => {
  it('returns all zeros and empty lists for a brand-new parent', async () => {
    const { res: parentRes } = await signupParent(app, { email: `dashnew_${Date.now()}@example.com` });
    const res = await request(app).get('/api/parents/me/dashboard').set('Authorization', `Bearer ${parentRes.body.access_token}`);

    expect(res.status).toBe(200);
    expect(res.body.children_count).toBe(0);
    expect(res.body.active_tutors_count).toBe(0);
    expect(res.body.lessons_this_month_count).toBe(0);
    expect(res.body.children).toEqual([]);
    expect(res.body.tutors).toEqual([]);
    // No fake/placeholder progress figure of any kind.
    expect(res.body).not.toHaveProperty('progress');
    expect(res.body).not.toHaveProperty('avg_progress');
  });

  it('counts children, distinguishes active vs past tutors, and lists real subjects per child/tutor', async () => {
    const { res: parentRes } = await signupParent(app, { email: `dashfull_${Date.now()}@example.com` });
    const parentToken = parentRes.body.access_token;
    await verifyUser(parentRes.body.user.id);

    const child1 = await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`)
      .send({ full_name: 'Kid One', grade_level: 'Primary 4' });
    const child2 = await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`)
      .send({ full_name: 'Kid Two', grade_level: 'Primary 6' });

    const activeTutor = await setupTutorWithRate(`dashtutor_active_${Date.now()}@example.com`);
    const pastTutor = await setupTutorWithRate(`dashtutor_past_${Date.now()}@example.com`);

    // Confirmed booking with the "active" tutor.
    const b1 = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`)
      .send({ tutor_id: activeTutor.id, child_id: child1.body.child.id, subject: 'Mathematics' });
    await request(app).patch(`/api/bookings/${b1.body.booking.id}/status`).set('Authorization', `Bearer ${activeTutor.token}`)
      .send({ status: 'confirmed' });

    // Completed (and finished) booking with the "past" tutor — confirm,
    // pay (a successful payment is required before a booking can be
    // marked completed — a real business rule, not a formality), then
    // complete it.
    const b2 = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`)
      .send({ tutor_id: pastTutor.id, child_id: child2.body.child.id, subject: 'English Language' });
    await request(app).patch(`/api/bookings/${b2.body.booking.id}/status`).set('Authorization', `Bearer ${pastTutor.token}`)
      .send({ status: 'confirmed' });
    const init = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`)
      .send({ booking_id: b2.body.booking.id, method: 'gateway' });
    await request(app).post('/api/payments/mock/complete').set('Authorization', `Bearer ${parentToken}`)
      .send({ reference: init.body.reference });
    const completeRes = await request(app).patch(`/api/bookings/${b2.body.booking.id}/status`).set('Authorization', `Bearer ${pastTutor.token}`)
      .send({ status: 'completed' });
    expect(completeRes.status).toBe(200); // guards against this test silently no-op'ing the way the investigation for this test found it could

    // A merely pending request shouldn't count toward active tutors at all.
    const otherTutor = await setupTutorWithRate(`dashtutor_pending_${Date.now()}@example.com`);
    await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`)
      .send({ tutor_id: otherTutor.id, child_id: child1.body.child.id, subject: 'Physics' });

    const res = await request(app).get('/api/parents/me/dashboard').set('Authorization', `Bearer ${parentToken}`);
    expect(res.status).toBe(200);
    expect(res.body.children_count).toBe(2);
    expect(res.body.active_tutors_count).toBe(1); // only the confirmed one
    expect(res.body.lessons_this_month_count).toBe(1); // only the completed one

    const kidOne = res.body.children.find((c) => c.full_name === 'Kid One');
    expect(kidOne.subjects).toEqual(['Mathematics']); // the pending booking's subject shouldn't appear — not a real lesson yet
    expect(kidOne.has_login).toBe(false);

    const tutorStatuses = Object.fromEntries(res.body.tutors.map((t) => [t.id, t.status]));
    expect(tutorStatuses[activeTutor.id]).toBe('active');
    expect(tutorStatuses[pastTutor.id]).toBe('past');
    expect(tutorStatuses[otherTutor.id]).toBeUndefined(); // pending-only tutor shouldn't appear at all
  });

  it('rejects a non-parent', async () => {
    const { res: tutorRes } = await signupTutor(app, { email: `dashwrongrole_${Date.now()}@example.com` });
    const res = await request(app).get('/api/parents/me/dashboard').set('Authorization', `Bearer ${tutorRes.body.access_token}`);
    expect(res.status).toBe(403);
  });
});
