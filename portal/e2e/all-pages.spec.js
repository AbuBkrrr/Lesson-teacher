// Every role, every page in its menu: the page renders a heading, and there
// are no JavaScript errors, console errors or failed API calls. The menu is
// read from the rendered sidebar, so a new page can't be silently skipped.
import { test, expect } from '@playwright/test';
import { uniqueEmail, verifyUserInDb, createAdminInDb } from './helpers.js';

test.use({ actionTimeout: 10000 });
const API = 'http://localhost:4000/api';

async function json(res) { expect(res.ok(), `${res.url()} -> ${res.status()}`).toBeTruthy(); return res.json(); }

async function signUp(request, role, extra = {}) {
  const email = uniqueEmail(`e2e-all-${role}`);
  const s = await json(await request.post(`${API}/auth/signup`, { data: { email, password: 'TestPass123', full_name: `All ${role}`, role, ...extra } }));
  verifyUserInDb(email);
  return s;
}

async function sessions(request) {
  const tutor = await signUp(request, 'tutor');
  const parent = await signUp(request, 'parent');
  const adult = await signUp(request, 'adult_student', { date_of_birth: '1995-05-05' });
  const school = await signUp(request, 'school_admin', { school_name: `All School ${Date.now()}` });
  const admin = createAdminInDb();
  const adminSession = await json(await request.post(`${API}/auth/login`, { data: { identifier: admin.email, password: admin.password } }));

  // Give pages real content: a child with a login, a paid lesson and a report.
  const P = { Authorization: `Bearer ${parent.access_token}` };
  const T = { Authorization: `Bearer ${tutor.access_token}` };
  await request.put(`${API}/tutors/me`, { headers: T, data: { hourly_rate: 2000, currency: 'NGN', subjects: [], bio: 'Patient maths tutor' } });
  const child = (await json(await request.post(`${API}/children`, { headers: P, data: { full_name: 'All Kid', age: 10 } }))).child;
  const invite = await json(await request.post(`${API}/children/${child.id}/invite`, { headers: P }));
  const kid = await json(await request.post(`${API}/auth/child/redeem-invite`, { data: { code: invite.code, username: `allkid${Date.now()}`, password: 'KidPass1234' } }));
  const b = (await json(await request.post(`${API}/bookings`, { headers: P, data: { tutor_id: tutor.user.id, child_id: child.id, subject: 'Maths', scheduled_at: new Date(Date.now() + 3 * 864e5).toISOString() } }))).booking;
  await json(await request.patch(`${API}/bookings/${b.id}/status`, { headers: T, data: { status: 'confirmed' } }));
  const pay = await json(await request.post(`${API}/payments/initialize`, { headers: P, data: { booking_id: b.id } }));
  await json(await request.post(`${API}/payments/mock/complete`, { headers: P, data: { reference: pay.reference } }));
  await json(await request.put(`${API}/bookings/${b.id}/report`, { headers: T, data: { summary: 'Fractions', score: 80 } }));
  await json(await request.post(`${API}/auditions`, { headers: P, data: { tutor_id: tutor.user.id, type: 'video' } }));

  return { tutor, parent, adult_student: adult, school_admin: school, super_admin: adminSession, child: kid };
}

let all;
test.beforeAll(async ({ request }) => { all = await sessions(request); });

for (const role of ['parent', 'tutor', 'child', 'adult_student', 'school_admin', 'super_admin']) {
  test(`${role}: every menu page loads cleanly`, async ({ page }) => {
    test.setTimeout(120000);
    const s = all[role];
    await page.addInitScript(([u, a, r]) => {
      localStorage.setItem('ltp_user_v1', u);
      localStorage.setItem('ltp_access_token_v1', a);
      localStorage.setItem('ltp_refresh_token_v1', r);
    }, [JSON.stringify(s.user), s.access_token, s.refresh_token]);

    const problems = [];
    let current = '';
    page.on('pageerror', (e) => problems.push(`${current}: JS error: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) problems.push(`${current}: console: ${m.text()}`); });
    page.on('response', (r) => {
      if (r.url().startsWith(API) && r.status() >= 400) problems.push(`${current}: ${r.request().method()} ${r.url().replace(API, '')} -> ${r.status()}`);
    });

    await page.goto('/#/');
    await page.waitForLoadState('networkidle');
    const links = await page.locator('aside a[href^="#/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
    expect(links.length, 'sidebar has links').toBeGreaterThan(2);
    const routes = [...new Set([...links, '#/account', '#/notifications'])];

    for (const href of routes) {
      current = href;
      await page.goto(`/${href}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('main h1').first(), `${href} has a heading`).toBeVisible();
      await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
      expect(page.url(), `${href} did not bounce to login`).not.toMatch(/#\/login/);
    }
    console.log(`${role}: ${routes.length} pages: ${routes.join(' ')}`);
    expect(problems, problems.join('\n')).toEqual([]);
  });
}
