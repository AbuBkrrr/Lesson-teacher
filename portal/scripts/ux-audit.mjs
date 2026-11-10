// Dev-time UX audit: logs in as each role, visits key pages, runs axe, checks
// horizontal overflow at phone width, and saves screenshots to $SHOTS.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'fs';
import { uniqueEmail, verifyUserInDb, createAdminInDb } from '../e2e/helpers.js';

const SHOTS = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = 'http://localhost:5173/#';
const LOCAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: fs.existsSync(LOCAL) ? LOCAL : undefined, args: ['--no-sandbox'] });

async function signup(role, name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const email = uniqueEmail(`audit-${role}`);
  await page.goto(`${BASE}/signup`);
  if (role === 'tutor') await page.locator('input[type="radio"][value="tutor"]').check();
  await page.locator('#full_name').fill(name);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('auditpass123');
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL(/#\/(parent|tutor)/);
  verifyUserInDb(email);
  return { ctx, page };
}
async function adminLogin() {
  const a = createAdminInDb();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.locator('#identifier, input[type="text"], input[type="email"]').first().fill(a.email);
  await page.locator('input[type="password"]').fill(a.password);
  await page.getByRole('button', { name: /log ?in|sign ?in/i }).click();
  await page.waitForURL(/#\/superadmin/);
  return { ctx, page };
}

const plan = [
  ['public', null, ['/login', '/signup', '/forgot-password']],
  ['parent', () => signup('parent', 'Audit Parent'), ['/parent', '/parent/discover', '/parent/browse', '/parent/saved', '/parent/children', '/parent/bookings', '/parent/requests', '/messages', '/subscriptions', '/verification', '/account']],
  ['tutor', () => signup('tutor', 'Audit Tutor'), ['/tutor', '/tutor/skills', '/tutor/availability', '/tutor/bookings', '/tutor/requests', '/tutor/earnings', '/tutor/materials', '/messages']],
  ['admin', adminLogin, ['/superadmin', '/superadmin/users', '/superadmin/payouts', '/superadmin/settings', '/superadmin/audit-log', '/superadmin/verifications']],
];

const report = [];
for (const [role, make, paths] of plan) {
  const sess = make ? await make() : { ctx: await browser.newContext({ viewport: { width: 1280, height: 800 } }) };
  const page = sess.page || (await sess.ctx.newPage());
  for (const p of paths) {
    const name = `${role}${p.replace(/\//g, '_')}`;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}${p}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(400);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const issues = axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact) || v.id === 'duplicate-id').map((v) => `${v.id}(${v.nodes.length})`);
    await page.screenshot({ path: `${SHOTS}/${name}.d.png`, fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: `${SHOTS}/${name}.m.png`, fullPage: false });
    report.push({ page: `${role}${p}`, url: page.url().split('#')[1], a11y: issues.join(' ') || '-', overflowPx: overflow > 1 ? overflow : 0 });
  }
  await sess.ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 0).replace(/\},\{/g, '},\n{'));
