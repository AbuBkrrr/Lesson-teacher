const request = require('supertest');
const { getApp, signupTutor, signupAdultStudent, verifyUser } = require('../helpers');

const app = getApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function setup() {
  const { res: t } = await signupTutor(app);
  const { res: a } = await signupAdultStudent(app);
  await request(app).put('/api/tutors/me').set(auth(t.body.access_token)).send({ hourly_rate: 4000, currency: 'NGN', subjects: [] });
  await verifyUser(t.body.user.id);
  await verifyUser(a.body.user.id);
  return { tutor: { token: t.body.access_token, id: t.body.user.id }, student: { token: a.body.access_token, id: a.body.user.id } };
}

async function confirmedBooking({ tutor, student }) {
  const b = await request(app).post('/api/bookings').set(auth(student.token)).send({ tutor_id: tutor.id, subject: 'Maths' });
  expect(b.status).toBe(201);
  const id = b.body.booking.id;
  expect((await request(app).patch(`/api/bookings/${id}/status`).set(auth(tutor.token)).send({ status: 'confirmed' })).status).toBe(200);
  return id;
}

describe('adult student: the whole lesson lifecycle', () => {
  it('can pay, chat, receive and submit assignments, and review', async () => {
    const ctx = await setup();
    const { tutor, student } = ctx;
    const bookingId = await confirmedBooking(ctx);

    // Pay for their own booking.
    const pay = await request(app).post('/api/payments/initialize').set(auth(student.token)).send({ booking_id: bookingId, method: 'gateway' });
    expect(pay.status).toBe(201);
    expect((await request(app).post('/api/payments/mock/complete').set(auth(student.token)).send({ reference: pay.body.reference })).status).toBe(200);
    const payments = await request(app).get('/api/payments/mine').set(auth(student.token));
    expect(payments.body.payments).toHaveLength(1);

    // Dashboard and subscription endpoints are reachable.
    expect((await request(app).get('/api/parents/me/dashboard').set(auth(student.token))).status).toBe(200);
    expect((await request(app).get('/api/subscriptions/mine').set(auth(student.token))).status).toBe(200);

    // Audition, recommendations, refund request and curriculum are open to adult students too.
    expect((await request(app).post('/api/auditions').set(auth(student.token)).send({ tutor_id: tutor.id })).status).toBe(201);
    expect((await request(app).get('/api/auditions/mine').set(auth(student.token))).body.auditions).toHaveLength(1);
    expect((await request(app).get('/api/curriculum').set(auth(student.token))).status).toBe(200);

    // Direct chat both ways.
    const conv = await request(app).post('/api/conversations').set(auth(student.token)).send({ tutor_id: tutor.id });
    expect(conv.status).toBe(201);
    const cid = conv.body.conversation.id;
    expect((await request(app).post(`/api/conversations/${cid}/messages`).set(auth(student.token)).send({ content: 'Hello!' })).status).toBe(201);
    expect((await request(app).post(`/api/conversations/${cid}/messages`).set(auth(tutor.token)).send({ content: 'Hi Ada' })).status).toBe(201);
    const unread = await request(app).get('/api/conversations/unread-count').set(auth(student.token));
    expect(unread.body.unread).toBe(1);

    // Assignment: tutor -> student -> submit -> grade.
    const asg = await request(app).post('/api/assignments').set(auth(tutor.token))
      .send({ student_user_id: student.id, booking_id: bookingId, title: 'Worksheet 1', instructions: 'Q1-3' });
    expect(asg.status).toBe(201);
    const aid = asg.body.assignment.id;
    const mine = await request(app).get('/api/assignments/mine').set(auth(student.token));
    expect(mine.body.assignments.map((x) => x.id)).toEqual([aid]);
    expect(mine.body.assignments[0].tutor_name).toBeTruthy();
    expect((await request(app).patch(`/api/assignments/${aid}/submit`).set(auth(student.token)).send({ content: 'Done' })).status).toBe(200);
    expect((await request(app).patch(`/api/assignments/${aid}/grade`).set(auth(tutor.token)).send({ grade: 'A' })).status).toBe(200);
    const tutorView = await request(app).get('/api/assignments/mine').set(auth(tutor.token));
    expect(tutorView.body.assignments[0]).toMatchObject({ id: aid, status: 'graded', child_name: expect.any(String) });

    // Complete the (paid) lesson and review it.
    expect((await request(app).patch(`/api/bookings/${bookingId}/status`).set(auth(tutor.token)).send({ status: 'completed' })).status).toBe(200);
    const review = await request(app).post('/api/reviews').set(auth(student.token)).send({ booking_id: bookingId, rating: 5, comment: 'Great' });
    expect(review.status).toBe(201);
    const refund = await request(app).post('/api/refund-requests').set(auth(student.token)).send({ booking_id: bookingId, resolution: 'reschedule', reason: 'Need another slot' });
    expect(refund.status).toBe(201);
    expect((await request(app).get('/api/refund-requests/mine').set(auth(student.token))).status).toBe(200);
    expect((await request(app).get('/api/tutors/recommended?skill_id=none').set(auth(student.token))).status).not.toBe(403);
    expect((await request(app).get('/api/reviews/mine').set(auth(student.token))).body.reviews).toHaveLength(1);
  });
});

describe('adult student: access boundaries', () => {
  it('only the assigned student can submit, and tutors need a booking and exactly one target', async () => {
    const ctx = await setup();
    const { tutor, student } = ctx;
    const bookingId = await confirmedBooking(ctx);
    const { res: other } = await signupAdultStudent(app);
    const stranger = { token: other.body.access_token, id: other.body.user.id };

    const noBooking = await request(app).post('/api/assignments').set(auth(tutor.token)).send({ student_user_id: stranger.id, title: 'X' });
    expect(noBooking.status).toBe(403);
    const both = await request(app).post('/api/assignments').set(auth(tutor.token)).send({ student_user_id: student.id, child_id: 'x', title: 'X' });
    expect(both.status).toBe(400);
    const neither = await request(app).post('/api/assignments').set(auth(tutor.token)).send({ title: 'X' });
    expect(neither.status).toBe(400);

    const asg = await request(app).post('/api/assignments').set(auth(tutor.token)).send({ student_user_id: student.id, booking_id: bookingId, title: 'Mine' });
    const hijack = await request(app).patch(`/api/assignments/${asg.body.assignment.id}/submit`).set(auth(stranger.token)).send({ content: 'nope' });
    expect(hijack.status).toBe(403);
    expect((await request(app).get('/api/assignments/mine').set(auth(stranger.token))).body.assignments).toEqual([]);
  });

  it('cannot read a tutor\'s materials without a confirmed booking, and cannot chat without one', async () => {
    const { res: t } = await signupTutor(app);
    const { res: a } = await signupAdultStudent(app);
    const tutorId = t.body.user.id;
    const token = a.body.access_token;
    const mats = await request(app).get(`/api/lesson-materials/tutor/${tutorId}`).set(auth(token));
    expect(mats.status).toBe(403);
    const chat = await request(app).post('/api/conversations').set(auth(token)).send({ tutor_id: tutorId });
    expect(chat.status).toBe(403);
  });
});
