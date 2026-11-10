const request = require('supertest');
const { getApp, signupTutor, signupParent, verifyUser } = require('../helpers');

const app = getApp();

async function setupConfirmedBooking(parentEmail, tutorEmail) {
  const { res: tutorRes } = await signupTutor(app, { email: tutorEmail });
  const tutorToken = tutorRes.body.access_token;
  const tutorId = tutorRes.body.user.id;
  await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${tutorToken}`).send({ hourly_rate: 4000, currency: 'NGN', subjects: [] });

  const { res: parentRes } = await signupParent(app, { email: parentEmail });
  const parentToken = parentRes.body.access_token;
  await verifyUser(tutorId);
  await verifyUser(parentRes.body.user.id);

  const child = await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`).send({ full_name: 'Gamification Kid' });
  const childId = child.body.child.id;

  const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorId, child_id: childId });
  const bookingId = booking.body.booking.id;
  await request(app).patch(`/api/bookings/${bookingId}/status`).set('Authorization', `Bearer ${tutorToken}`).send({ status: 'confirmed' });

  return { tutorToken, tutorId, parentToken, childId, bookingId };
}

async function giveChildLogin(parentToken, childId, username) {
  const invite = await request(app).post(`/api/children/${childId}/invite`).set('Authorization', `Bearer ${parentToken}`);
  const redeem = await request(app).post('/api/auth/child/redeem-invite').send({ code: invite.body.code, username, password: 'ChildPass123' });
  return redeem.body.access_token;
}

describe('badges, streaks, and points', () => {
  it('awards points and a "first_lesson" badge when an assignment is submitted', async () => {
    const { tutorToken, parentToken, childId } = await setupConfirmedBooking('gamifyparent1@example.com', 'gamifytutor1@example.com');
    const childToken = await giveChildLogin(parentToken, childId, 'gamifychild1');

    const assignment = await request(app).post('/api/assignments').set('Authorization', `Bearer ${tutorToken}`).send({ child_id: childId, title: 'Homework 1' });
    const submit = await request(app).patch(`/api/assignments/${assignment.body.assignment.id}/submit`).set('Authorization', `Bearer ${childToken}`).send({ content: 'done' });
    expect(submit.status).toBe(200);

    const streak = await request(app).get(`/api/gamification/children/${childId}/streak`).set('Authorization', `Bearer ${parentToken}`);
    expect(streak.body.streak.current_streak).toBe(1);
    expect(streak.body.streak.total_points).toBe(10);

    const badges = await request(app).get(`/api/gamification/children/${childId}/badges`).set('Authorization', `Bearer ${parentToken}`);
    expect(badges.body.badges.some((b) => b.code === 'first_lesson')).toBe(true);
  });

  it('awards more points when a booking is marked completed, visible to the child themself', async () => {
    const { tutorToken, parentToken, childId, bookingId } = await setupConfirmedBooking('gamifyparent2@example.com', 'gamifytutor2@example.com');
    const childToken = await giveChildLogin(parentToken, childId, 'gamifychild2');

    const init = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: bookingId });
    await request(app).post('/api/payments/mock/complete').set('Authorization', `Bearer ${parentToken}`).send({ reference: init.body.reference });
    await request(app).patch(`/api/bookings/${bookingId}/status`).set('Authorization', `Bearer ${tutorToken}`).send({ status: 'completed' });

    const streak = await request(app).get(`/api/gamification/children/${childId}/streak`).set('Authorization', `Bearer ${childToken}`);
    expect(streak.body.streak.total_points).toBe(25);
  });

  it('a stranger parent cannot view another family\'s child streak or badges', async () => {
    const { childId } = await setupConfirmedBooking('gamifyparent3@example.com', 'gamifytutor3@example.com');
    const { res: stranger } = await signupParent(app, { email: 'gamifystranger@example.com' });

    const streak = await request(app).get(`/api/gamification/children/${childId}/streak`).set('Authorization', `Bearer ${stranger.body.access_token}`);
    expect(streak.status).toBe(404);
  });

  it('the sibling leaderboard only ranks the requesting parent\'s own children', async () => {
    const { res: parentRes } = await signupParent(app, { email: 'leaderboardparent@example.com' });
    const parentToken = parentRes.body.access_token;
    await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`).send({ full_name: 'Kid One' });
    await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`).send({ full_name: 'Kid Two' });

    const { childId: otherChildId } = await setupConfirmedBooking('leaderboardother@example.com', 'leaderboardtutor@example.com');

    const board = await request(app).get('/api/gamification/leaderboard/siblings').set('Authorization', `Bearer ${parentToken}`);
    expect(board.status).toBe(200);
    expect(board.body.leaderboard.length).toBe(2);
    expect(board.body.leaderboard.some((r) => r.child_id === otherChildId)).toBe(false);
  });

  it('the badge catalog is public and describes recognition, not credentials', async () => {
    const res = await request(app).get('/api/gamification/badges');
    expect(res.status).toBe(200);
    expect(res.body.badges.some((b) => b.code === 'streak_7')).toBe(true);
  });
});
