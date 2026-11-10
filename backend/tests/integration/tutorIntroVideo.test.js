const request = require('supertest');
const { getApp, signupTutor, signupParent } = require('../helpers');

const app = getApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const video = Buffer.from('not-really-a-video');

async function tutorWithProfile() {
  const { res } = await signupTutor(app);
  const token = res.body.access_token;
  await request(app).put('/api/tutors/me').set(auth(token)).send({ bio: 'Hi', hourly_rate: 3000, city: 'Abuja', teaches_online: true });
  return { token, id: res.body.user.id };
}

describe('tutor intro video', () => {
  it('uploads a 1-2 minute video, shows it on the tutor card, and can be removed', async () => {
    const { token } = await tutorWithProfile();
    const up = await request(app).post('/api/tutors/me/intro-video').set(auth(token))
      .field('duration_seconds', '90').attach('file', video, { filename: 'intro.mp4', contentType: 'video/mp4' });
    expect(up.status).toBe(201);
    expect(up.body.profile.intro_video_url).toMatch(/\/uploads\//);
    expect(up.body.profile.intro_video_duration_seconds).toBe(90);

    const { res: parent } = await signupParent(app);
    const list = await request(app).get('/api/tutors?city=Abuja').set(auth(parent.body.access_token));
    expect(list.body.tutors[0].intro_video_url).toBe(up.body.profile.intro_video_url);

    expect((await request(app).delete('/api/tutors/me/intro-video').set(auth(token))).status).toBe(200);
    expect((await request(app).get('/api/tutors/me').set(auth(token))).body.profile.intro_video_url).toBeNull();
  });

  it('rejects videos over two minutes, non-videos, and missing duration', async () => {
    const { token } = await tutorWithProfile();
    const send = (f, type, dur) => {
      const r = request(app).post('/api/tutors/me/intro-video').set(auth(token));
      if (dur !== undefined) r.field('duration_seconds', String(dur));
      return r.attach('file', video, { filename: f, contentType: type });
    };
    expect((await send('long.mp4', 'video/mp4', 200)).body.error).toMatch(/2 minutes/);
    expect((await send('doc.pdf', 'application/pdf', 60)).status).toBe(400);
    expect((await send('x.mp4', 'video/mp4')).body.error).toMatch(/duration/);
  });

  it('is tutor-only', async () => {
    const { res: parent } = await signupParent(app);
    const r = await request(app).post('/api/tutors/me/intro-video').set(auth(parent.body.access_token))
      .field('duration_seconds', '60').attach('file', video, { filename: 'a.mp4', contentType: 'video/mp4' });
    expect(r.status).toBe(403);
  });
});

describe('tutor card privacy', () => {
  it('never exposes payout/bank details in the list or saved tutors', async () => {
    const { token, id } = await tutorWithProfile();
    await request(app).put('/api/tutors/me/bank-account').set(auth(token))
      .send({ bank_name: 'Test Bank', bank_code: '058', account_number: '0123456789', account_name: 'Tola Tutor' });
    const { res: parent } = await signupParent(app);
    const pt = parent.body.access_token;
    await request(app).post(`/api/tutors/${id}/favorite`).set(auth(pt));

    const list = await request(app).get('/api/tutors?city=Abuja').set(auth(pt));
    const saved = await request(app).get('/api/tutors/favorites/mine').set(auth(pt));
    for (const body of [JSON.stringify(list.body), JSON.stringify(saved.body)]) {
      expect(body).not.toContain('0123456789');
      expect(body).not.toMatch(/account_number|account_name|bank_code|payout_recipient_code/);
    }
    expect(list.body.tutors.length).toBeGreaterThan(0);
  });
});
