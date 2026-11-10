// Child login + school admin walkthrough.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'fs';
import { uniqueEmail, verifyUserInDb } from '../e2e/helpers.js';
const SHOTS = '/tmp/deep2'; fs.mkdirSync(SHOTS, { recursive: true });
const BASE = 'http://localhost:5173/#';
const LOCAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: fs.existsSync(LOCAL) ? LOCAL : undefined, args: ['--no-sandbox'] });
const issues = []; let n = 0;
const watch = (page, who) => {
  page.on('pageerror', (e) => issues.push(`[${who}] pageerror ${e.message.slice(0, 120)}`));
  page.on('response', (r) => r.status() >= 400 && r.url().includes('/api/') && issues.push(`[${who}] ${r.status()} ${r.request().method()} ${r.url().replace(/.*\/api/, '')} @ ${page.url().replace(/.*#/, '')}`));
};
async function check(page, who, label) {
  n++; await page.waitForTimeout(500);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  for (const v of axe.violations) if (['serious', 'critical'].includes(v.impact) || v.id === 'duplicate-id') issues.push(`[${who}] axe ${v.id}(${v.nodes.length}) @ ${label}`);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (ov > 2) issues.push(`[${who}] overflow ${ov}px @ ${label}`);
  await page.screenshot({ path: `${SHOTS}/${String(n).padStart(2, '0')}_${who}_${label}.png` });
}
const S = async (label, fn) => { try { await fn(); } catch (e) { issues.push(`STEP FAILED ${label}: ${e.message.split('\n')[0].slice(0, 170)}`); } };
async function signup(role, name, fill) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(); watch(page, role);
  const email = uniqueEmail(`d2-${role}`);
  await page.goto(`${BASE}/signup`);
  if (role !== 'parent') await page.locator(`input[type="radio"][value="${role}"]`).check();
  await page.locator('#full_name').fill(name); await page.locator('#email').fill(email); await page.locator('#password').fill('TestPass123');
  if (fill) await fill(page);
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL(/#\/(parent|school)/);
  verifyUserInDb(email); await page.reload();
  return { page, email, ctx };
}
// ---- Child
const P = await signup('parent', 'D2 Parent');
let code;
await S('parent grants child login', async () => {
  const p = P.page; await p.goto(`${BASE}/parent/children`);
  await p.getByLabel('Full name').fill('D2 Child'); await p.getByLabel('Grade level').fill('Primary 5');
  await p.getByRole('button', { name: /add child|save|create/i }).first().click();
  await p.getByText('D2 Child').first().waitFor();
  await p.getByRole('button', { name: /give login/i }).click();
  await p.getByText(/Login code for/).waitFor({ timeout: 5000 });
  await check(p, 'parent', 'child-code');
  code = (await p.locator('text=/^[A-Z0-9]{6}$/').first().innerText()).trim();
});
await S('child redeems code', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const c = await ctx.newPage(); watch(c, 'child'); P.child = c;
  await c.goto(`${BASE}/login`); await check(c, 'child', 'login');
  await c.getByRole('link', { name: /use it here/i }).click(); await check(c, 'child', 'redeem-form');
  await c.locator('#code').fill(code); await c.locator('#username').fill(`kid${Date.now()}`.slice(0, 20)); await c.locator('#childPassword').fill('KidPass123');
  await c.getByRole('button', { name: /create|start|continue|sign/i }).last().click();
  await c.waitForURL(/#\/assignments/, { timeout: 8000 });
});
await S('child pages', async () => {
  const c = P.child;
  const links = await c.$$eval('nav a, aside a', (as) => [...new Set(as.map((a) => a.getAttribute('href')))].filter((h) => h && h.startsWith('#/')));
  console.log('child nav:', links.join(' '));
  for (const l of links) {
    await c.goto(`http://localhost:5173/${l}`); await c.waitForLoadState('networkidle').catch(() => {}); await check(c, 'child', l.replace(/[#/]/g, '_'));
    const txt = (await c.locator('main, body').first().innerText()).trim();
    if (txt.length < 60) issues.push(`[child] near-empty page ${l}`);
  }
  await c.setViewportSize({ width: 375, height: 800 }); await c.goto(`${BASE}/assignments`); await check(c, 'child', 'mobile-assignments');
});
// ---- School admin
const joinName = `D2 School ${Date.now()}`;
const A = await signup('school_admin', 'D2 SchoolAdmin', async (p) => { await p.locator('#school_name').fill(joinName); });
await S('school pages', async () => {
  const p = A.page;
  const links = await p.$$eval('nav a, aside a', (as) => [...new Set(as.map((a) => a.getAttribute('href')))].filter((h) => h && h.startsWith('#/')));
  console.log('school nav:', links.join(' '));
  for (const l of links) { await p.goto(`http://localhost:5173/${l}`); await p.waitForLoadState('networkidle').catch(() => {}); await check(p, 'school', l.replace(/[#/]/g, '_')); }
});
await S('school profile save', async () => {
  const p = A.page; await p.goto(`${BASE}/school`);
  await p.getByLabel('Address').fill('1 Test Road'); await p.getByLabel('Contact email').fill('school@example.com');
  await p.getByRole('button', { name: /save changes/i }).click();
  await p.getByText(/saved|updated/i).first().waitFor({ timeout: 5000 });
});
await S('school lookup parent + add student', async () => {
  const p = A.page; await p.goto(`${BASE}/school/students`);
  await p.getByLabel(/Parent's email or phone/).fill(P.email);
  await p.getByRole('button', { name: /look up/i }).click(); await p.waitForTimeout(1200); await check(p, 'school', 'students-lookup');
  console.log('lookup:', (await p.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 300));
});
await browser.close();
console.log(issues.length ? [...new Set(issues)].join('\n') : 'no issues');
