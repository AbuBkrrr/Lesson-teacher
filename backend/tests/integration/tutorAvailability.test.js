const request = require('supertest');
const { getApp, signupTutor, signupParent } = require('../helpers');

const app = getApp();

describe('tutor availability', () => {
  it('a tutor can set and fetch their own weekly schedule', async () => {
    const { res: tutorRes } = await signupTutor(app);
    const token = tutorRes.body.access_token;

    const empty = await request(app).get('/api/tutors/me/availability').set('Authorization', `Bearer ${token}`);
    expect(empty.status).toBe(200);
    expect(empty.body.slots).toEqual([]);

    const put = await request(app).put('/api/tutors/me/availability').set('Authorization', `Bearer ${token}`).send({
      slots: [
        { day_of_week: 1, start_time: '14:00', end_time: '17:00' },
        { day_of_week: 3, start_time: '09:00', end_time: '12:00' },
      ],
    });
    expect(put.status).toBe(200);
    expect(put.body.slots).toHaveLength(2);
    expect(put.body.slots[0]).toMatchObject({ day_of_week: 1, start_time: '14:00', end_time: '17:00' });

    const get = await request(app).get('/api/tutors/me/availability').set('Authorization', `Bearer ${token}`);
    expect(get.body.slots).toHaveLength(2);
  });

  it('replacing the schedule drops previous slots rather than appending', async () => {
    const { res: tutorRes } = await signupTutor(app);
    const token = tutorRes.body.access_token;

    await request(app).put('/api/tutors/me/availability').set('Authorization', `Bearer ${token}`)
      .send({ slots: [{ day_of_week: 1, start_time: '09:00', end_time: '10:00' }] });
    const second = await request(app).put('/api/tutors/me/availability').set('Authorization', `Bearer ${token}`)
      .send({ slots: [{ day_of_week: 5, start_time: '15:00', end_time: '16:00' }] });

    expect(second.body.slots).toHaveLength(1);
    expect(second.body.slots[0].day_of_week).toBe(5);
  });

  it('rejects an invalid day_of_week, bad time format, and start >= end', async () => {
    const { res: tutorRes } = await signupTutor(app);
    const token = tutorRes.body.access_token;

    const badDay = await request(app).put('/api/tutors/me/availability').set('Authorization', `Bearer ${token}`)
      .send({ slots: [{ day_of_week: 7, start_time: '09:00', end_time: '10:00' }] });
    expect(badDay.status).toBe(400);

    const badTime = await request(app).put('/api/tutors/me/availability').set('Authorization', `Bearer ${token}`)
      .send({ slots: [{ day_of_week: 1, start_time: '9am', end_time: '10:00' }] });
    expect(badTime.status).toBe(400);

    const inverted = await request(app).put('/api/tutors/me/availability').set('Authorization', `Bearer ${token}`)
      .send({ slots: [{ day_of_week: 1, start_time: '10:00', end_time: '09:00' }] });
    expect(inverted.status).toBe(400);
  });

  it('a parent can view a tutor\'s published availability by id', async () => {
    const { res: tutorRes } = await signupTutor(app);
    await request(app).put('/api/tutors/me/availability').set('Authorization', `Bearer ${tutorRes.body.access_token}`)
      .send({ slots: [{ day_of_week: 2, start_time: '13:00', end_time: '15:00' }] });

    const { res: parentRes } = await signupParent(app);
    const view = await request(app)
      .get(`/api/tutors/${tutorRes.body.user.id}/availability`)
      .set('Authorization', `Bearer ${parentRes.body.access_token}`);

    expect(view.status).toBe(200);
    expect(view.body.slots).toEqual([{ day_of_week: 2, start_time: '13:00', end_time: '15:00' }]);
  });

  it('404s for a non-tutor id', async () => {
    const { res: parentRes } = await signupParent(app);
    const res = await request(app)
      .get(`/api/tutors/${parentRes.body.user.id}/availability`)
      .set('Authorization', `Bearer ${parentRes.body.access_token}`);
    expect(res.status).toBe(404);
  });
});
