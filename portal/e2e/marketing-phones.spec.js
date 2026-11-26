// Several real browser "phones" in different cities open one tracking link.
// One phone reopens it three times; others are people the link was forwarded
// to. The super admin's Marketing tab must tell them apart.
//
// Needs the backend started with TRUST_PROXY=1 so each phone's
// X-Forwarded-For address is used for its location (as behind nginx in
// production). Skips itself otherwise.
import { test, expect, devices } from '@playwright/test';
import { createAdminInDb } from './helpers.js';

test.use({ actionTimeout: 15000 });
const API = 'http://localhost:4000/api';
const SHOTS = 'test-results/marketing';

const PHONES = [
  { name: 'Samsung in Lagos', device: 'Galaxy S24', ip: '102.89.32.1', timezoneId: 'Africa/Lagos', locale: 'en-NG', geolocation: { latitude: 6.45, longitude: 3.39 } },
  { name: 'iPhone in Accra', device: 'iPhone 15 Pro', ip: '154.160.1.1', timezoneId: 'Africa/Accra', locale: 'en-GH', geolocation: { latitude: 5.6, longitude: -0.19 } },
  { name: 'Pixel in Nairobi, opened inside Instagram', device: 'Pixel 7', ip: '41.90.64.1', timezoneId: 'Africa/Nairobi', locale: 'sw-KE', geolocation: { latitude: -1.29, longitude: 36.82 }, inApp: ' Instagram 312.0.0.0' },
  { name: 'iPhone in São Paulo', device: 'iPhone 14', ip: '177.32.1.1', timezoneId: 'America/Sao_Paulo', locale: 'pt-BR', geolocation: { latitude: -23.55, longitude: -46.63 } },
  { name: 'Galaxy in Johannesburg', device: 'Galaxy A55', ip: '41.13.1.1', timezoneId: 'Africa/Johannesburg', locale: 'en-ZA', geolocation: { latitude: -26.2, longitude: 28.04 } },
];

async function phone(browser, p) {
  const d = devices[p.device];
  const context = await browser.newContext({
    ...d,
    userAgent: d.userAgent + (p.inApp || ''),
    locale: p.locale,
    timezoneId: p.timezoneId,
    geolocation: p.geolocation,
    extraHTTPHeaders: { 'X-Forwarded-For': p.ip },
  });
  return { context, page: await context.newPage() };
}

test('Marketing tab tells a returning phone from a forwarded link, with locations', async ({ browser, request }) => {
  test.setTimeout(180000);
  const probe = await request.post(`${API}/marketing/open`, { headers: { 'X-Forwarded-For': '102.89.32.1' }, data: { device_id: 'probe_trustproxy_000' } });
  test.skip(!probe.ok(), 'backend not reachable');

  // Super admin creates a WhatsApp link in the UI.
  const admin = createAdminInDb();
  const adminCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const ap = await adminCtx.newPage();
  await ap.goto('/#/login');
  await ap.locator('#identifier').fill(admin.email);
  await ap.locator('#password').fill(admin.password);
  await ap.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(ap).toHaveURL(/#\/superadmin/);
  await ap.getByRole('link', { name: /Marketing/ }).click();
  const label = `Parents WhatsApp group ${Date.now()}`;
  const leadName = `Wanjiru Kamau ${Date.now() % 100000}`;
  await ap.getByLabel('Label').fill(label);
  await ap.getByLabel('Where it will be posted').selectOption('whatsapp');
  await ap.getByLabel('Aimed at').selectOption('parent');
  await ap.getByRole('button', { name: 'Create link + QR' }).click();
  await expect(ap.getByRole('heading', { name: `Share kit: ${label}` })).toBeVisible();
  await expect(ap.getByRole('img', { name: `QR code for ${label}` })).toBeVisible();
  const link = await ap.locator('#mk-url').inputValue();
  expect(link).toMatch(/#\/go\/[a-z0-9]+\?utm_source=whatsapp$/);
  const path = link.replace(/^https?:\/\/[^/]+/, '');

  // Phone 1 (Lagos) opens the link, comes back later, and opens it a third time.
  const [p1, ...others] = PHONES;
  const lagos = await phone(browser, p1);
  // Each time: a fresh tab on the same phone (same browser storage), like tapping the link again in WhatsApp.
  let lagosTab = lagos.page;
  for (let i = 0; i < 3; i++) {
    if (i > 0) { await lagosTab.close(); lagosTab = await lagos.context.newPage(); }
    await lagosTab.goto(path);
    await expect(lagosTab.getByRole('heading', { level: 1 })).toBeVisible();
    await lagosTab.waitForLoadState('networkidle');
  }
  await lagosTab.screenshot({ path: `${SHOTS}/phone-lagos-pitch.png` });

  await ap.reload();
  const sharedTable = ap.locator('section[aria-labelledby="mk-shared"]');
  let row = sharedTable.locator('tr', { hasText: label });
  await expect(row).toContainText('1 device, opened 3×');

  // The link was forwarded: four other people in other cities open it.
  const contexts = [lagos.context];
  for (const p of others) {
    const ph = await phone(browser, p);
    contexts.push(ph.context);
    await ph.page.goto(path);
    await expect(ph.page.getByRole('heading', { level: 1 })).toBeVisible();
    await ph.page.waitForLoadState('networkidle');
    if (p.locale === 'pt-BR') {
      // Brazilian phone: the page should be in Portuguese.
      await expect(ph.page.getByRole('link', { name: 'Encontrar um tutor' })).toBeVisible();
      await ph.page.screenshot({ path: `${SHOTS}/phone-saopaulo-pitch-pt.png` });
    }
    if (p.name.includes('Nairobi')) {
      // This person asks for a call-back after reading the page.
      await ph.page.getByLabel('Your name').fill(leadName);
      await ph.page.getByLabel('Email').fill(`wanjiru${Date.now()}@example.com`);
      await ph.page.getByLabel('Phone (WhatsApp is fine)').fill('+254712345678');
      await ph.page.locator('.lt-pitch-consent input').check();
      await ph.page.getByRole('button', { name: 'Request a call-back' }).click();
      await expect(ph.page.getByText(/we will contact you shortly/i)).toBeVisible();
    }
    if (p.name.includes('Johannesburg')) {
      // This person signs up straight away.
      await ph.page.getByRole('link', { name: 'Find a tutor' }).click();
      await ph.page.locator('#full_name').fill('Thabo Nkosi');
      await ph.page.locator('#email').fill(`thabo${Date.now()}@example.com`);
      await ph.page.locator('#password').fill('TestPass123');
      await ph.page.getByRole('button', { name: /create account/i }).click();
      await expect(ph.page).toHaveURL(/#\/parent/);
    }
  }

  // The admin sees: shared with 5 devices, the Lagos phone's 3 opens, cities, the lead and the sign-up.
  await ap.reload();
  row = sharedTable.locator('tr', { hasText: label });
  await expect(row).toContainText('Shared · 5 devices');
  await expect(row.locator('td[data-label="Opens"]')).toHaveText('7');
  await expect(row.locator('td[data-label="Different devices"]')).toHaveText('5');
  await expect(row.locator('td[data-label="Repeat opens"]')).toHaveText('2');
  await expect(row.locator('td[data-label="Leads"]')).toHaveText('1');
  await expect(row.locator('td[data-label="Sign-ups"]')).toHaveText('1');

  await row.getByRole('button', { name: 'Opens' }).click();
  const recent = ap.locator('section[aria-labelledby="mk-recent"] tbody tr');
  await expect(recent).toHaveCount(7);
  const statuses = (await recent.locator('td[data-label="Opened by"] .lt-badge').allInnerTexts()).reverse();
  const deviceNos = (await recent.locator('td[data-label="Device"]').allInnerTexts()).reverse();
  expect(deviceNos.map((d, i) => `${d} ${statuses[i]}`)).toEqual([
    '#1 New device', '#1 Same device · open #2', '#1 Same device · open #3',
    '#2 New device', '#3 New device', '#4 New device', '#5 New device',
  ]);
  const places = await recent.locator('td[data-label="Location"]').allInnerTexts();
  for (const city of ['Lagos', 'Accra', 'Nairobi', 'São Paulo', 'Johannesburg']) {
    expect(places.join(' '), city).toContain(city);
  }
  const phones = (await recent.locator('td[data-label="Phone / browser"]').allInnerTexts()).join(' ');
  expect(phones).toMatch(/Android/);
  expect(phones).toMatch(/iOS/);
  expect(phones).toMatch(/Instagram/);

  const leadRow = ap.locator('section[aria-labelledby="mk-leads"] tr', { hasText: leadName });
  await expect(leadRow).toContainText('1× before asking');
  await expect(leadRow).toContainText('Nairobi');

  await ap.screenshot({ path: `${SHOTS}/admin-marketing-tab.png`, fullPage: true });
  for (const c of contexts) await c.close();
});
