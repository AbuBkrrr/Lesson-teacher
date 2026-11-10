// Full-journey UX pass: signup per role, then visit every nav link; log console errors, 4xx/5xx, overflow, empty pages.
import { chromium } from 'playwright';
import fs from 'fs';
import { uniqueEmail, verifyUserInDb } from '../e2e/helpers.js';
const SHOTS = process.env.SHOTS || '/tmp/journey'; fs.mkdirSync(SHOTS, { recursive: true });
const BASE = 'http://localhost:5173/#';
const LOCAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: fs.existsSync(LOCAL) ? LOCAL : undefined, args: ['--no-sandbox'] });
const out = [];
for (const role of ['parent', 'adult_student', 'tutor']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text().slice(0, 140)));
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 140)));
  page.on('response', (r) => r.status() >= 400 && r.url().includes('/api/') && errs.push(`${r.status()} ${r.request().method()} ${r.url().replace(/.*\/api/, '')}`));
  const email = uniqueEmail(`j-${role}`);
  await page.goto(`${BASE}/signup`);
  if (role !== 'parent') await page.locator(`input[type="radio"][value="${role}"]`).check();
  await page.locator('#full_name').fill(`Journey ${role}`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('TestPass123');
  if (role === 'adult_student') await page.locator('input[type="date"]').fill('2000-01-01').catch(() => {});
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForTimeout(2000);
  const landed = page.url().replace(/.*#/, '');
  verifyUserInDb(email);
  await page.reload(); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/${role}_home.png` });
  const links = await page.$$eval('nav a, aside a', (as) => [...new Set(as.map((a) => a.getAttribute('href')))].filter((h) => h && h.startsWith('#/')));
  const r = { role, landed, links: links.length, pages: [] };
  for (const l of links) {
    errs.length = 0;
    await page.goto(`http://localhost:5173/${l}`); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500);
    const body = (await page.locator('main, body').first().innerText()).trim();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
    await page.screenshot({ path: `${SHOTS}/${role}_${l.replace(/[#/]/g, '_')}.png` });
    r.pages.push({ l, chars: body.length, overflow, errs: [...errs] });
  }
  out.push(r); await ctx.close();
}
await browser.close();
for (const r of out) {
  console.log(`\n## ${r.role}: landed ${r.landed}, ${r.links} nav links`);
  for (const p of r.pages) if (p.errs.length || p.overflow || p.chars < 60) console.log(`  ${p.l} chars=${p.chars} overflow=${p.overflow} ${p.errs.join(' | ')}`);
}
