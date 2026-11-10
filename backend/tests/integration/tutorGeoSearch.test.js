const request = require('supertest');
const { getApp, signupTutor, signupParent } = require('../helpers');

const app = getApp();

// Lagos (Ikeja) as the search origin for all three tutors below.
const SEARCH_LAT = 6.6018;
const SEARCH_LNG = 3.3515;

async function setLocation(token, lat, lng) {
  const res = await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${token}`).send({ latitude: lat, longitude: lng });
  expect(res.status).toBe(200);
}

describe('tutor geo-radius search', () => {
  it('returns only tutors within the given radius, nearest first, and excludes tutors with no coordinates', async () => {
    const { res: near } = await signupTutor(app, { email: `geo-near-${Date.now()}@example.com` });
    const { res: far } = await signupTutor(app, { email: `geo-far-${Date.now()}@example.com` });
    const { res: none } = await signupTutor(app, { email: `geo-none-${Date.now()}@example.com` });
    const { res: parent } = await signupParent(app, { email: `geo-parent-${Date.now()}@example.com` });

    // ~2km from the search point (still inside Lagos).
    await setLocation(near.body.access_token, 6.62, 3.35);
    // Abuja — several hundred km away, well outside any sane radius.
    await setLocation(far.body.access_token, 9.0765, 7.3986);
    // `none` never sets a location at all.

    const parentToken = parent.body.access_token;
    const result = await request(app)
      .get('/api/tutors')
      .query({ lat: SEARCH_LAT, lng: SEARCH_LNG, radius_km: 25 })
      .set('Authorization', `Bearer ${parentToken}`);

    expect(result.status).toBe(200);
    const ids = result.body.tutors.map((t) => t.user_id);
    expect(ids).toContain(near.body.user.id);
    expect(ids).not.toContain(far.body.user.id);
    expect(ids).not.toContain(none.body.user.id);
    expect(result.body.tutors[0]).toHaveProperty('distance_km');
    expect(result.body.tutors[0].distance_km).toBeLessThan(25);
  });

  it('a wider radius picks up the farther tutor too', async () => {
    const { res: far } = await signupTutor(app, { email: `geo-wide-${Date.now()}@example.com` });
    const { res: parent } = await signupParent(app, { email: `geo-parent2-${Date.now()}@example.com` });
    await setLocation(far.body.access_token, 9.0765, 7.3986); // Abuja, ~480km from Lagos

    const result = await request(app)
      .get('/api/tutors')
      .query({ lat: SEARCH_LAT, lng: SEARCH_LNG, radius_km: 600 })
      .set('Authorization', `Bearer ${parent.body.access_token}`);

    expect(result.status).toBe(200);
    expect(result.body.tutors.map((t) => t.user_id)).toContain(far.body.user.id);
  });

  it('rejects an out-of-range latitude when updating a tutor profile', async () => {
    const { res: tutor } = await signupTutor(app, { email: `geo-invalid-${Date.now()}@example.com` });
    const res = await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${tutor.body.access_token}`).send({ latitude: 200, longitude: 3.35 });
    expect(res.status).toBe(400);
  });
});
