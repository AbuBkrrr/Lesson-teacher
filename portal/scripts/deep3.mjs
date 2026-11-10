import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'fs';
import { uniqueEmail, verifyUserInDb, createAdminInDb } from '../e2e/helpers.js';
const SHOTS = '/tmp/deep3'; fs.mkdirSync(SHOTS, { recursive: true });
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
  await page.screenshot({ path: `${SHOTS}/${String(n).padStart(2, '0')}_${who}_${label}.png` });
}
const S = async (label, fn) => { try { await fn(); } catch (e) { issues.push(`STEP FAILED ${label}: ${e.message.split('\n')[0].slice(0, 170)}`); } };
async function signup(role, name, fill, extraFields = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(); watch(page, role);
  const email = uniqueEmail(`d3-${role}`);
  await page.goto(`${BASE}/signup`);
  if (role !== 'parent') await page.locator(`input[type="radio"][value="${role}"]`).check();
  await page.locator('#full_name').fill(name); await page.locator('#email').fill(email); await page.locator('#password').fill('TestPass123');
  if (fill) await fill(page);
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL(/#\/(parent|school|tutor)/);
  verifyUserInDb(email); await page.reload();
  return { page, email };
}
// paid material by tutor
const T = await signup('tutor', 'D3 Tutor');
await S('tutor paid material', async () => {
  const p = T.page; await p.goto(`${BASE}/tutor/materials`);
  await p.getByLabel('Title').fill('Paid worksheet');
  await p.locator('#material-file-input').setInputFiles('/tmp/sample.txt');
  await p.getByLabel(/paid material/i).check();
  await p.getByLabel(/price/i).fill('1500');
  await check(p, 'tutor', 'materials-paid');
  await p.getByRole('button', { name: /^upload$/i }).click();
  await p.getByText('NGN 1500').waitFor({ timeout: 6000 });
});
// school: add new student for a parent
const P = await signup('parent', 'D3 Parent');
const A = await signup('school_admin', 'D3 Admin', async (p) => { await p.locator('#school_name').fill(`D3 School ${Date.now()}`); });
await S('school add new student', async () => {
  const p = A.page; await p.goto(`${BASE}/school/students`);
  await p.getByLabel(/Parent's email or phone/).fill(P.email);
  await p.getByRole('button', { name: /look up/i }).click();
  await p.getByLabel("Student's full name").fill('D3 Kid'); await p.getByLabel('Grade level').fill('JSS1');
  await p.getByRole('button', { name: /add as new student/i }).click();
  await p.getByText('D3 Kid').first().waitFor({ timeout: 6000 });
  await check(p, 'school', 'student-added');
});
// admin
const adm = createAdminInDb();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const ap = await ctx.newPage(); watch(ap, 'admin');
await S('admin login + pages', async () => {
  await ap.goto(`${BASE}/login`);
  await ap.locator('#identifier').fill(adm.email); await ap.locator('#password').fill(adm.password);
  await ap.getByRole('button', { name: /sign in/i }).click(); await ap.waitForURL(/#\/superadmin/);
  const links = await ap.$$eval('nav a, aside a', (as) => [...new Set(as.map((a) => a.getAttribute('href')))].filter((h) => h && h.startsWith('#/')));
  console.log('admin nav:', links.join(' '));
  for (const l of links) { await ap.goto(`http://localhost:5173/${l}`); await ap.waitForLoadState('networkidle').catch(() => {}); await check(ap, 'admin', l.replace(/[#/]/g, '_')); }
});
await S('admin users search/suspend', async () => {
  await ap.goto(`${BASE}/superadmin/users`); await ap.waitForLoadState('networkidle');
  console.log('users btns:', await ap.getByRole('button').allInnerTexts());
});
await browser.close();
console.log(issues.length ? [...new Set(issues)].join('\n') : 'no issues');
