// Child + school admin deep walkthrough with real interactions.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'fs';
import { uniqueEmail, verifyUserInDb } from '../e2e/helpers.js';
const SHOTS = '/tmp/deep5'; fs.mkdirSync(SHOTS, { recursive: true });
const BASE = 'http://localhost:5173/#'; const API = 'http://localhost:4000/api';
const LOCAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: fs.existsSync(LOCAL) ? LOCAL : undefined, args: ['--no-sandbox'] });
const issues = []; let n = 0;
const watch = (page, who) => {
  page.on('pageerror', (e) => issues.push(`[${who}] pageerror ${e.message.slice(0, 120)}`));
  page.on('dialog', (d) => { issues.push(`[${who}] native dialog: ${d.message().slice(0, 60)}`); d.dismiss(); });
  page.on('response', (r) => r.status() >= 400 && r.url().includes('/api/') && issues.push(`[${who}] ${r.status()} ${r.request().method()} ${r.url().replace(/.*\/api/, '')} @ ${page.url().replace(/.*#/, '')}`));
};
async function check(page, who, label) {
  n++; await page.waitForTimeout(400);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  for (const v of axe.violations) if (['serious', 'critical'].includes(v.impact) || v.id === 'duplicate-id') issues.push(`[${who}] axe ${v.id}(${v.nodes.length}) @ ${label}`);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (ov > 2) issues.push(`[${who}] overflow ${ov}px @ ${label}`);
  await page.screenshot({ path: `${SHOTS}/${String(n).padStart(2, '0')}_${who}_${label}.png` });
}
const S = async (label, fn) => { try { await fn(); } catch (e) { issues.push(`STEP FAILED ${label}: ${e.message.split('\n')[0].slice(0, 170)}`); } };
const api = async (path, token, method = 'GET', data) => { const r = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data ? JSON.stringify(data) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const mk = async (role, name, extra = {}) => { const email = uniqueEmail(`d5-${role}`); const r = await api('/auth/signup', null, 'POST', { email, password: 'TestPass123', full_name: name, role, ...extra }); verifyUserInDb(email); return { email, token: r.body.access_token, id: r.body.user.id }; };

// ---- API setup: school, parent+child, tutor, confirmed paid booking, assignment
const adminS = await mk('school_admin', 'D5 SchoolAdmin', { school_name: `D5 School ${Date.now()}` });
const tutor = await mk('tutor', 'D5 Tutor'); await api('/tutors/me', tutor.token, 'PUT', { hourly_rate: 2000, currency: 'NGN', subjects: [] });
const parent = await mk('parent', 'D5 Parent');
const kid = await api('/children', parent.token, 'POST', { full_name: 'D5 Kid', grade_level: 'JSS2' });
const code = (await api(`/children/${kid.body.child.id}/invite`, parent.token, 'POST')).body.code;
// link the child to the school through the school admin API
const bk = await api('/bookings', parent.token, 'POST', { tutor_id: tutor.id, child_id: kid.body.child.id, subject: 'Maths' });
await api(`/bookings/${bk.body.booking.id}/status`, tutor.token, 'PATCH', { status: 'confirmed' });
await api('/assignments', tutor.token, 'POST', { child_id: kid.body.child.id, title: 'Fractions drill', instructions: 'Do page 4' });

// ---- Child UI
const kidCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const K = await kidCtx.newPage(); watch(K, 'child');
await S('child redeem', async () => {
  await K.goto(`${BASE}/login`); await K.getByRole('link', { name: /use it here/i }).click();
  await K.locator('#code').fill(code); await K.locator('#username').fill(`kid${Date.now()}`.slice(0, 20)); await K.locator('#childPassword').fill('KidPass123');
  await K.getByRole('button', { name: /create|start|continue|sign/i }).last().click(); await K.waitForURL(/#\/assignments/, { timeout: 8000 });
});
await S('child assignment submit', async () => {
  await K.getByText('Fractions drill').waitFor({ timeout: 6000 }); await check(K, 'child', 'assignments');
  await K.locator('textarea').first().fill('Done: 1/2 + 1/3 = 5/6'); await K.getByRole('button', { name: /submit/i }).first().click(); await K.waitForTimeout(1200); await check(K, 'child', 'submitted');
  console.log('child assignment row:', (await K.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 220));
});
for (const l of ['materials', 'curriculum', 'my-badges', 'messages', 'account']) await S('child ' + l, async () => { await K.goto(`${BASE}/${l}`); await K.waitForLoadState('networkidle'); await check(K, 'child', l); const t = (await K.locator('main').innerText()).replace(/\s+/g, ' '); console.log(`child ${l}:`, t.slice(0, 140)); });
await S('child mobile', async () => { await K.setViewportSize({ width: 375, height: 800 }); for (const l of ['assignments', 'my-badges', 'messages']) { await K.goto(`${BASE}/${l}`); await K.waitForLoadState('networkidle'); await check(K, 'child', 'm_' + l); } });
await S('child cannot reach adult pages', async () => { await K.goto(`${BASE}/parent/bookings`); await K.waitForTimeout(800); console.log('child -> /parent/bookings lands on:', K.url().replace(/.*#/, '')); await K.goto(`${BASE}/superadmin`); await K.waitForTimeout(800); console.log('child -> /superadmin lands on:', K.url().replace(/.*#/, '')); });

// ---- School admin UI
const aCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const A = await aCtx.newPage(); watch(A, 'school');
await S('school login', async () => { await A.goto(`${BASE}/login`); await A.locator('#identifier').fill(adminS.email); await A.locator('#password').fill('TestPass123'); await A.getByRole('button', { name: /sign in/i }).click(); await A.waitForURL(/#\/school/); });
await S('school profile', async () => { await A.goto(`${BASE}/school`); await A.waitForLoadState('networkidle'); await check(A, 'school', 'profile'); console.log('school profile:', (await A.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200)); });
await S('school link child by parent lookup', async () => {
  await A.goto(`${BASE}/school/students`); await A.getByLabel(/Parent's email or phone/).fill(parent.email); await A.getByRole('button', { name: /look up/i }).click();
  await A.getByRole('button', { name: /^link$/i }).click(); await A.getByText('D5 Kid').first().waitFor({ timeout: 6000 }); await check(A, 'school', 'student-linked');
});
await S('school curriculum unit', async () => {
  await A.goto(`${BASE}/curriculum`); await A.waitForLoadState('networkidle');
  await A.locator('#curriculum-f1').fill('Fractions unit'); await A.locator('#curriculum-f2').fill('Adding fractions'); await check(A, 'school', 'curriculum-form');
  await A.getByRole('button', { name: /add unit/i }).click(); await A.getByText('Fractions unit').first().waitFor({ timeout: 6000 }); await check(A, 'school', 'curriculum-added');
});
await S('school referrals + subscriptions', async () => { for (const l of ['school/referrals', 'subscriptions']) { await A.goto(`${BASE}/${l}`); await A.waitForLoadState('networkidle'); await check(A, 'school', l.replace('/', '_')); console.log(l + ':', (await A.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 160)); } });
await S('child sees school curriculum + leaderboard after link', async () => {
  await K.setViewportSize({ width: 1280, height: 900 });
  await K.goto(`${BASE}/login`); await K.reload(); await K.goto(`${BASE}/curriculum`); await K.waitForLoadState('networkidle');
  console.log('child curriculum after link has unit:', (await K.getByText('Fractions unit').count()) > 0);
});
await browser.close();
console.log(issues.length ? [...new Set(issues)].join('\n') : 'no issues');
