// Every page, every role, at phone, tablet and laptop widths: nothing may
// make the page scroll sideways. Wide tables may scroll inside their own box
// (the usual pattern on phones), but the page itself must fit the screen.
import { test, expect } from '@playwright/test';
import { sessions } from './roleSessions.js';

test.use({ actionTimeout: 10000 });

const SIZES = [
  { name: 'small-android', width: 320, height: 640, isMobile: true, hasTouch: true },
  { name: 'android', width: 360, height: 780, isMobile: true, hasTouch: true },
  { name: 'iphone', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'tablet', width: 768, height: 1024, isMobile: true, hasTouch: true },
  { name: 'laptop', width: 1280, height: 800, isMobile: false, hasTouch: false },
];
const PUBLIC = ['#/login', '#/signup', '#/signup?role=tutor', '#/forgot-password', '#/go'];

/** Elements whose box sticks out past the right edge of the screen, outside any horizontal scroll container. */
function findOverflow() {
  const W = document.documentElement.clientWidth;
  const out = [];
  const scrollsX = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if ((ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') && p.getBoundingClientRect().right <= W + 1) return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed' && el.closest('.lt-sidebar')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.right <= W + 1) continue;
    if (scrollsX(el)) continue;
    // Report only the outermost offender, not every child of it.
    const parent = el.parentElement;
    if (parent && parent !== document.body && parent.getBoundingClientRect().right > W + 1 && !scrollsX(parent)) continue;
    const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '';
    out.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40)}" right=${Math.round(r.right)}`);
  }
  return { pageScrollsSideways: document.documentElement.scrollWidth > W + 1, offenders: out.slice(0, 8), width: W };
}

let all;
test.beforeAll(async ({ request }) => { all = await sessions(request); });

for (const size of SIZES) {
  test(`${size.name} (${size.width}px): every page for every role fits the screen`, async ({ browser }) => {
    test.setTimeout(300000);
    const problems = [];

    async function check(page, routes, who) {
      for (const href of routes) {
        await page.goto(`/${href}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(100);
        const r = await page.evaluate(findOverflow);
        if (r.pageScrollsSideways || r.offenders.length) problems.push(`[${who}] ${href}: ${r.offenders.join(' | ') || `page is ${r.width}px but scrolls sideways`}`);
      }
    }

    // Public pages, signed out.
    const anon = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.isMobile, hasTouch: size.hasTouch });
    await check(await anon.newPage(), PUBLIC, 'visitor');
    await anon.close();

    for (const role of ['parent', 'tutor', 'child', 'adult_student', 'school_admin', 'super_admin']) {
      const s = all[role];
      const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.isMobile, hasTouch: size.hasTouch });
      await ctx.addInitScript(([u, a, r]) => {
        localStorage.setItem('ltp_user_v1', u);
        localStorage.setItem('ltp_access_token_v1', a);
        localStorage.setItem('ltp_refresh_token_v1', r);
      }, [JSON.stringify(s.user), s.access_token, s.refresh_token]);
      const page = await ctx.newPage();
      await page.goto('/#/');
      await page.waitForLoadState('networkidle');
      const links = await page.locator('aside a[href^="#/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
      await check(page, [...new Set([...links, '#/account', '#/notifications'])], role);

      // On phones the menu must open from the top bar and show every page.
      if (size.width < 769) {
        await page.goto('/#/account');
        const menuBtn = page.getByRole('button', { name: 'Open menu' });
        await expect(menuBtn, `${role}: menu button on ${size.name}`).toBeVisible();
        await menuBtn.click();
        await expect(page.locator('aside a[href^="#/"]').first()).toBeInViewport();
        if (role === 'parent' && size.name === 'iphone') await page.screenshot({ path: 'test-results/responsive/iphone-parent-menu.png' });
      }
      await ctx.close();
    }
    expect(problems, `Pages that don't fit ${size.width}px:\n${problems.join('\n')}`).toEqual([]);
  });
}
