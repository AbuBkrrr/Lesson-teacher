// Deep UI journey: tutor + parent happy path through the real UI. Logs errors, duplicate ids, dead ends.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'fs';
import { uniqueEmail, verifyUserInDb } from '../e2e/helpers.js';
const SHOTS = '/tmp/deep'; fs.mkdirSync(SHOTS, { recursive: true });
const BASE = 'http://localhost:5173/#';
const LOCAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: fs.existsSync(LOCAL) ? LOCAL : undefined, args: ['--no-sandbox'] });
const issues = [];
let step = 0;
function watch(page, who) {
  page.on('pageerror', (e) => issues.push(`[${who}] pageerror ${e.message.slice(0, 120)}`));
  page.on('response', (r) => r.status() >= 400 && r.url().includes('/api/') && issues.push(`[${who}] ${r.status()} ${r.request().method()} ${r.url().replace(/.*\/api/, '')} @ ${page.url().replace(/.*#/, '')}`));
}
async function check(page, who, label) {
  step++;
  await page.waitForTimeout(500);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  for (const v of axe.violations) if (['serious', 'critical'].includes(v.impact) || v.id === 'duplicate-id') issues.push(`[${who}] axe ${v.id}(${v.nodes.length}) @ ${label}`);
  await page.screenshot({ path: `${SHOTS}/${String(step).padStart(2, '0')}_${who}_${label}.png` });
  const alert = await page.locator('.lt-alert--error, .lt-error, [role="alert"]').allInnerTexts().catch(() => []);
  if (alert.length) issues.push(`[${who}] alert @ ${label}: ${alert.join(' | ').slice(0, 140)}`);
}
async function step_(label, fn) { try { await fn(); } catch (e) { issues.push(`STEP FAILED ${label}: ${e.message.split('\n')[0].slice(0, 160)}`); } }
async function signup(role, name, extra) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(); watch(page, role);
  const email = uniqueEmail(`deep-${role}`);
  await page.goto(`${BASE}/signup`);
  if (role !== 'parent') await page.locator(`input[type="radio"][value="${role}"]`).check();
  await page.locator('#full_name').fill(name);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('TestPass123');
  if (extra) await extra(page);
  await check(page, role, 'signup-form');
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL(/#\/(parent|tutor)/);
  verifyUserInDb(email); await page.reload();
  return { page, email };
}
function nextMonday10() { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T10:00`; }
const city = `DeepCity${Date.now()}`;
const tname = `Deep Tutor ${Date.now()}`;
const T = await signup('tutor', tname);
await step_('tutor profile', async () => {
  const p = T.page; await p.goto(`${BASE}/tutor`);
  await p.getByLabel('Qualifications').fill('B.Ed Maths');
  await p.getByLabel('Hourly rate').fill('4000');
  await p.getByLabel('Bio').fill('Patient maths tutor.');
  await p.locator('input[placeholder="e.g. Lagos"]').fill(city);
  await check(p, 'tutor', 'profile-filled');
  await p.getByRole('button', { name: /save profile/i }).click();
  await p.getByText(/profile updated/i).waitFor({ timeout: 5000 });
});
await step_('tutor skills', async () => {
  const p = T.page; await p.goto(`${BASE}/tutor/skills`); await p.waitForLoadState('networkidle');
  await check(p, 'tutor', 'skills');
});
await step_('tutor availability', async () => {
  const p = T.page; await p.goto(`${BASE}/tutor/availability`);
  await p.getByRole('button', { name: /add (a )?slot|add/i }).first().click();
  await check(p, 'tutor', 'availability');
  await p.getByRole('button', { name: /save/i }).click();
  await p.waitForTimeout(800);
});
const P = await signup('parent', 'Deep Parent');
await step_('parent add child', async () => {
  const p = P.page; await p.goto(`${BASE}/parent/children`);
  await p.getByLabel('Full name').fill('Deep Child'); await p.getByLabel('Grade level').fill('Primary 4');
  await check(p, 'parent', 'children-form');
  await p.getByRole('button', { name: /add child|save|create/i }).first().click();
  await p.getByText('Deep Child').first().waitFor({ timeout: 5000 });
  await check(p, 'parent', 'children-added');
});
await step_('parent browse+book', async () => {
  const p = P.page; await p.goto(`${BASE}/parent/browse`);
  await p.locator('input[placeholder="e.g. Lagos"]').fill(city);
  await p.getByText(tname).waitFor({ timeout: 8000 });
  await p.locator('select[id^="findtutor-f5"]').first().selectOption({ label: 'Deep Child' });
  await p.locator('input[id^="findtutor-f6"]').first().fill('Maths');
  await p.locator('input[id^="findtutor-f7"]').first().fill(nextMonday10());
  await check(p, 'parent', 'browse-results');
  await p.getByRole('button', { name: /request booking/i }).first().click();
  await p.getByText(/booking requested/i).waitFor({ timeout: 5000 });
});
await step_('tutor confirms', async () => {
  const p = T.page; await p.goto(`${BASE}/tutor/bookings`); await p.waitForLoadState('networkidle');
  await check(p, 'tutor', 'bookings-pending');
  await p.getByRole('button', { name: /confirm|accept/i }).first().click();
  await p.waitForTimeout(1000); await check(p, 'tutor', 'bookings-confirmed');
});
await step_('parent pays', async () => {
  const p = P.page; await p.goto(`${BASE}/parent/bookings`); await p.waitForLoadState('networkidle');
  await check(p, 'parent', 'bookings-confirmed');
  await p.getByRole('button', { name: /pay/i }).first().click();
  await p.waitForTimeout(2500); await check(p, 'parent', 'after-pay-click');
  await p.getByRole('button', { name: /^Card$/ }).click();
  await p.waitForTimeout(2500); await check(p, 'parent', 'card-chosen');
  console.log('card url:', p.url(), (await p.locator('main').innerText()).slice(0, 400).replace(/\n+/g, ' | '));
});
await step_('simulate pay', async () => {
  const p = P.page;
  await p.getByRole('button', { name: /simulate successful payment/i }).click();
  await p.waitForTimeout(1500); await check(p, 'parent', 'paid');
  console.log('paid row:', (await p.locator('tbody').innerText()).replace(/\s+/g, ' ').slice(0, 200));
});
await step_('parent messages tutor', async () => {
  const p = P.page; await p.getByRole('button', { name: /^message$/i }).first().click();
  await p.waitForTimeout(1500); console.log('msg url:', p.url());
  await check(p, 'parent', 'chat-open');
  const box = p.locator('textarea, input[placeholder*="essage"]').first();
  await box.fill('Hello tutor'); await p.getByRole('button', { name: /^send$/i }).click();
  await p.getByText('Hello tutor').first().waitFor({ timeout: 5000 });
});
await step_('tutor replies', async () => {
  const p = T.page; await p.goto(`${BASE}/messages`); await p.waitForLoadState('networkidle');
  await check(p, 'tutor', 'inbox');
  await p.getByText(/Deep Parent/).first().click();
  await p.getByText('Hello tutor').first().waitFor({ timeout: 5000 });
  const box = p.locator('textarea, input[placeholder*="essage"]').first();
  await box.fill('Hi parent'); await p.getByRole('button', { name: /^send$/i }).click();
  await p.getByText('Hi parent').first().waitFor({ timeout: 5000 });
});
await step_('tutor assignment', async () => {
  const p = T.page; await p.goto(`${BASE}/tutor/assignments`); await p.waitForLoadState('networkidle');
  await p.locator('select').first().selectOption({ index: 1 });
  await p.getByLabel('Title').fill('Fractions'); await p.getByLabel('Instructions').fill('Do page 4');
  await check(p, 'tutor', 'assignment-form');
  await p.getByRole('button', { name: /send assignment/i }).click();
  await p.getByText(/assignment sent/i).waitFor({ timeout: 5000 });
});
await step_('tutor completes lesson', async () => {
  const p = T.page; await p.goto(`${BASE}/tutor/bookings`); await p.waitForLoadState('networkidle');
  await p.getByRole('button', { name: /complete/i }).first().click(); await p.waitForTimeout(1200);
  await check(p, 'tutor', 'completed');
});
await step_('parent reviews', async () => {
  const p = P.page; await p.goto(`${BASE}/parent/bookings`); await p.waitForLoadState('networkidle');
  await check(p, 'parent', 'bookings-completed');
  await p.getByRole('button', { name: /leave review/i }).click();
  await check(p, 'parent', 'review-form');
  await p.getByLabel('Comment (optional)').fill('Great lesson');
  await p.getByRole('button', { name: /^submit$/i }).click();
  await p.getByText(/thanks for your review/i).waitFor({ timeout: 5000 });
  await p.getByRole('button', { name: /refund\/reschedule/i }).click();
  await p.getByLabel('Reason').fill('Need another slot');
  await p.getByRole('button', { name: /^submit$/i }).click();
  await p.getByText(/request submitted/i).waitFor({ timeout: 5000 });
  await check(p, 'parent', 'after-review-refund');
});
for (const [who, sess, paths] of [['parent', P, ['/parent', '/parent/children', '/parent/browse', '/parent/bookings', '/messages', '/assignments', '/materials']], ['tutor', T, ['/tutor', '/tutor/bookings', '/tutor/assignments', '/tutor/materials', '/tutor/earnings', '/messages']]]) {
  await sess.page.setViewportSize({ width: 375, height: 800 });
  for (const p of paths) {
    await sess.page.goto(`${BASE}${p}`); await sess.page.waitForLoadState('networkidle').catch(() => {}); await sess.page.waitForTimeout(400);
    const ov = await sess.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (ov > 2) issues.push(`[${who}] mobile overflow ${ov}px @ ${p}`);
    await sess.page.screenshot({ path: `${SHOTS}/m_${who}${p.replace(/\//g, '_')}.png` });
  }
}
await browser.close();
console.log(issues.length ? [...new Set(issues)].join('\n') : 'no issues');
