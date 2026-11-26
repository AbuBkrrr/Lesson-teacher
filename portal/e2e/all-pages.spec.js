// Every role, every page in its menu: the page renders a heading, and there
// are no JavaScript errors, console errors or failed API calls. The menu is
// read from the rendered sidebar, so a new page can't be silently skipped.
import { test, expect } from '@playwright/test';
import { sessions } from './roleSessions.js';

test.use({ actionTimeout: 10000 });
const API = 'http://localhost:4000/api';

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
