// Trust X-Forwarded-For so each simulated phone can come from its own public IP.
process.env.TRUST_PROXY = '1';
const request = require('supertest');
const db = require('../../src/config/db');
const { getApp, signupParent, createSuperAdmin } = require('../helpers');
const { parseUserAgent, resolveDevice, verdict } = require('../../src/services/marketing');

const app = getApp();

const PHONES = {
  samsungLagos: { ua: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36', ip: '102.89.32.1', tz: 'Africa/Lagos', lang: 'en-NG', screen: '412x915' },
  iphoneLondon: { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', ip: '81.2.69.142', tz: 'Europe/London', lang: 'en-GB', screen: '393x852' },
  pixelInstagram: { ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 Instagram 312.0.0.0', ip: '8.8.8.8', tz: 'America/Chicago', lang: 'en-US', screen: '412x915' },
};

async function adminToken() {
  const a = await createSuperAdmin();
  const r = await request(app).post('/api/auth/login').send({ identifier: a.email, password: a.password });
  return r.body.access_token;
}

function openAs(phone, body) {
  return request(app).post('/api/marketing/open').set('User-Agent', phone.ua).set('X-Forwarded-For', phone.ip)
    .send({ timezone: phone.tz, language: phone.lang, screen: phone.screen, ...body });
}

describe('marketing tracking', () => {
  it('reads phones from the user agent', () => {
    expect(parseUserAgent(PHONES.samsungLagos.ua)).toMatchObject({ os: 'Android', os_version: '14', device_type: 'mobile', browser: 'Samsung Internet', device_model: 'SM-S921B' });
    expect(parseUserAgent(PHONES.iphoneLondon.ua)).toMatchObject({ os: 'iOS', os_version: '17.4', browser: 'Safari', device_model: 'iPhone' });
    expect(parseUserAgent(PHONES.pixelInstagram.ua)).toMatchObject({ os: 'Android', in_app: 'Instagram', device_model: 'Pixel 7' });
    expect(verdict(3, 1)).toBe('1 device, opened 3×');
    expect(verdict(4, 2)).toBe('Shared · 2 devices');
    expect(resolveDevice({ device_id: 'short', screen: '1x1', userAgent: '' }).source).toBe('fingerprint');
  });

  it('tells a returning device from a shared link, with location, leads and sign-ups', async () => {
    const token = await adminToken();
    const A = { Authorization: `Bearer ${token}` };

    // Only admins can make links.
    const { res: parent } = await signupParent(app);
    expect((await request(app).post('/api/marketing/links').set('Authorization', `Bearer ${parent.body.access_token}`).send({ label: 'x' })).status).toBe(403);

    const created = await request(app).post('/api/marketing/links').set(A).send({ label: 'WhatsApp parents group', channel: 'whatsapp', audience: 'parent', campaign: 'Back to school' });
    expect(created.status).toBe(201);
    const { slug, id: linkId, url } = created.body.link;
    expect(url).toMatch(new RegExp(`#/go/${slug}$`));

    // Phone 1 (Samsung, Lagos) opens the link three times.
    const devA = 'devA_0123456789abcdef';
    const o1 = await openAs(PHONES.samsungLagos, { slug, device_id: devA, utm: { source: 'whatsapp' } });
    expect(o1.status).toBe(201);
    expect(o1.body).toMatchObject({ device_no: 1, open_no: 1, is_new_device: true });
    await openAs(PHONES.samsungLagos, { slug, device_id: devA });
    const o3 = await openAs(PHONES.samsungLagos, { slug, device_id: devA });
    expect(o3.body).toMatchObject({ device_no: 1, open_no: 3, is_new_device: false });

    let ov = await request(app).get('/api/marketing/overview').set(A);
    let row = ov.body.links.find((l) => l.id === linkId);
    expect(row).toMatchObject({ opens: 3, devices: 1, repeat_opens: 2, verdict: '1 device, opened 3×' });

    // The link is forwarded: an iPhone in London and an Instagram user (US IP) open it.
    const o4 = await openAs(PHONES.iphoneLondon, { slug, device_id: 'devB_0123456789abcdef' });
    expect(o4.body).toMatchObject({ device_no: 2, open_no: 1 });
    await openAs(PHONES.pixelInstagram, { slug, device_id: 'devC_0123456789abcdef' });

    ov = await request(app).get('/api/marketing/overview').set(A);
    row = ov.body.links.find((l) => l.id === linkId);
    expect(row).toMatchObject({ opens: 5, devices: 3, repeat_opens: 2, verdict: 'Shared · 3 devices' });
    expect(ov.body.breakdowns.countries.map((c) => c.key)).toEqual(expect.arrayContaining(['NG', 'GB', 'US']));
    expect(ov.body.breakdowns.cities.map((c) => c.key)).toEqual(expect.arrayContaining(['Lagos, NG']));
    expect(ov.body.breakdowns.in_app.map((c) => c.key)).toContain('Instagram');
    expect(ov.body.map.length).toBeGreaterThan(0);

    // Recent opens are labelled new / same device with per-link device numbers.
    const recent = await request(app).get(`/api/marketing/opens?link_id=${linkId}`).set(A);
    const statuses = recent.body.opens.slice().reverse().map((o) => `#${o.device_no} ${o.status}`);
    expect(statuses).toEqual(['#1 New device', '#1 Same device · open #2', '#1 Same device · open #3', '#2 New device', '#3 New device']);
    expect(recent.body.opens[recent.body.opens.length - 1]).toMatchObject({ city: 'Lagos', country: 'NG', os: 'Android', browser: 'Samsung Internet' });

    // Without a device ID, the rough signature still recognises the same phone.
    const f1 = await openAs(PHONES.iphoneLondon, { slug });
    const f2 = await openAs(PHONES.iphoneLondon, { slug });
    expect(f2.body.device_no).toBe(f1.body.device_no);
    expect(f2.body.open_no).toBe(2);

    // Opens of the plain pitch page (no link) are grouped as "(no label)".
    await openAs(PHONES.samsungLagos, { device_id: devA });
    ov = await request(app).get('/api/marketing/overview').set(A);
    expect(ov.body.links.find((l) => l.label === '(no label)')).toMatchObject({ opens: 1, devices: 1 });

    // A lead from phone 1 records how many times that device had opened the page.
    const bad = await request(app).post('/api/marketing/leads').set('X-Forwarded-For', PHONES.samsungLagos.ip).send({ slug, full_name: 'Ada' });
    expect(bad.status).toBe(400);
    const lead = await request(app).post('/api/marketing/leads').set('User-Agent', PHONES.samsungLagos.ua).set('X-Forwarded-For', PHONES.samsungLagos.ip)
      .send({ slug, device_id: devA, full_name: 'Ada Obi', email: `ada${Date.now()}@example.com`, interest: 'parent', consent_marketing: true });
    expect(lead.status).toBe(201);
    const leads = await request(app).get('/api/marketing/leads').set(A);
    const myLead = leads.body.leads.find((l) => l.id === lead.body.id);
    expect(myLead).toMatchObject({ opens_before: 4, country: 'NG', city: 'Lagos', label: 'WhatsApp parents group', consent_marketing: 1 });
    expect(myLead.unsubscribe_token).toBeUndefined();

    // That person signs up from the same phone: the sign-up and the lead are credited.
    const signup = await request(app).post('/api/auth/signup').send({ role: 'parent', full_name: 'Ada Obi', email: myLead.email, password: 'TestPass123', attribution: { slug, device_id: devA } });
    expect(signup.status).toBe(201);
    ov = await request(app).get('/api/marketing/overview').set(A);
    row = ov.body.links.find((l) => l.id === linkId);
    expect(row).toMatchObject({ leads: 1, signups: 1 });
    expect(ov.body.totals.converted_leads).toBeGreaterThanOrEqual(1);

    // Follow-up e-mail goes only to consenting leads; unsubscribe stops it.
    const noConsent = await request(app).post('/api/marketing/leads').set('X-Forwarded-For', PHONES.iphoneLondon.ip)
      .send({ slug, full_name: 'No Mail', email: `nomail${Date.now()}@example.com` });
    const mail = await request(app).post('/api/marketing/leads/email').set(A)
      .send({ subject: 'Your free trial lesson', body: 'Hi {name}, book a trial.', lead_ids: [lead.body.id, noConsent.body.id] });
    expect(mail.body).toMatchObject({ sent: 1, skipped: 1 });
    const token2 = (await db.prepare('SELECT unsubscribe_token FROM marketing_leads WHERE id = ?').get(lead.body.id)).unsubscribe_token;
    expect((await request(app).post(`/api/marketing/unsubscribe/${token2}`)).status).toBe(200);
    const again = await request(app).post('/api/marketing/leads/email').set(A).send({ subject: 'x', body: 'y', lead_ids: [lead.body.id] });
    expect(again.body).toMatchObject({ sent: 0, skipped: 1 });

    // CSV export neutralises spreadsheet formulas.
    await request(app).post('/api/marketing/leads').set('X-Forwarded-For', '8.8.4.4').send({ full_name: '=HYPERLINK("x")', phone: '+2348012345678' });
    const csv = await request(app).get('/api/marketing/leads.csv').set(A);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain(`"'=HYPERLINK(""x"")"`);

    // Ad tag IDs are validated and exposed publicly for the pitch page.
    expect((await request(app).put('/api/marketing/settings').set(A).send({ meta_pixel_id: 'abc' })).status).toBe(400);
    await request(app).put('/api/marketing/settings').set(A).send({ meta_pixel_id: '123456789012', google_tag_id: 'G-ABC123XYZ' });
    const pub = await request(app).get('/api/marketing/public-config');
    expect(pub.body).toMatchObject({ meta_pixel_id: '123456789012', google_tag_id: 'G-ABC123XYZ' });
    await request(app).put('/api/marketing/settings').set(A).send({ meta_pixel_id: '', google_tag_id: '' });

    // Unknown link codes are refused; private IPs get no location.
    expect((await openAs(PHONES.samsungLagos, { slug: 'nope000' })).status).toBe(404);
    const local = await request(app).post('/api/marketing/open').set('X-Forwarded-For', '192.168.1.5').send({ slug, device_id: 'devLocal_0123456789ab' });
    const localRow = await db.prepare('SELECT country FROM marketing_opens WHERE device_key = ?').get('id:devLocal_0123456789ab');
    expect(local.status).toBe(201);
    expect(localRow.country).toBeNull();
  });

  it('numbers devices correctly when many phones open at once', async () => {
    const token = await adminToken();
    const link = (await request(app).post('/api/marketing/links').set('Authorization', `Bearer ${token}`).send({ label: 'Burst test' })).body.link;
    await Promise.all(Array.from({ length: 8 }, (_, i) => openAs(PHONES.iphoneLondon, { slug: link.slug, device_id: `burst${i}_0123456789abcdef` })));
    const rows = await db.prepare('SELECT device_no FROM marketing_opens WHERE link_id = ? ORDER BY device_no').all(link.id);
    expect(rows.map((r) => Number(r.device_no))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
