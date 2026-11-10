import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'fs';
import { uniqueEmail, verifyUserInDb, createAdminInDb } from '../e2e/helpers.js';
const SHOTS = '/tmp/deep4'; fs.mkdirSync(SHOTS, { recursive: true });
const BASE = 'http://localhost:5173/#';
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
  await page.screenshot({ path: `${SHOTS}/${String(n).padStart(2, '0')}_${who}_${label}.png` });
}
const S = async (label, fn) => { try { await fn(); } catch (e) { issues.push(`STEP FAILED ${label}: ${e.message.split('\n')[0].slice(0, 170)}`); for (const [w, pg] of [['P', globalThis.PP], ['T', globalThis.TT]]) { if (pg) { await pg.screenshot({ path: `${SHOTS}/FAIL_${label.replace(/\W+/g, '_')}_${w}.png` }).catch(() => {}); console.log('FAIL', label, w, (await pg.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 260)); } } } };
async function signup(role, name, { verify = true, fill } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(); watch(page, role);
  const email = uniqueEmail(`d4-${role}`);
  await page.goto(`${BASE}/signup`);
  if (role !== 'parent') await page.locator(`input[type="radio"][value="${role}"]`).check();
  await page.locator('#full_name').fill(name); await page.locator('#email').fill(email); await page.locator('#password').fill('TestPass123');
  if (fill) await fill(page);
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL(/#\/(parent|school|tutor)/);
  if (verify) verifyUserInDb(email); await page.reload();
  return { page, email, name };
}
const city = `D4City${Date.now()}`; const tname = `D4 Tutor ${Date.now()}`;
const T = await signup('tutor', tname);
await T.page.goto(`${BASE}/tutor`);
await T.page.getByLabel('Hourly rate').fill('3000'); await T.page.locator('input[placeholder="e.g. Lagos"]').fill(city);
await T.page.getByRole('button', { name: /save profile/i }).click(); await T.page.getByText(/profile updated/i).waitFor();
const P = await signup('parent', 'D4 Parent');
globalThis.PP = P.page; globalThis.TT = T.page;

// ---- Auditions
await S('parent requests audition', async () => {
  const p = P.page; await p.goto(`${BASE}/parent/browse`);
  await p.locator('input[placeholder="e.g. Lagos"]').fill(city);
  await p.getByText(tname).waitFor({ timeout: 8000 });
  await p.getByRole('button', { name: /request audition/i }).first().click();
  await p.waitForTimeout(1200); await check(p, 'parent', 'audition-requested');
  console.log('audition msg:', (await p.locator('main').innerText()).match(/audition[^\n]*/i)?.[0]);
});
await S('parent auditions page', async () => { await P.page.goto(`${BASE}/parent/auditions`); await P.page.waitForLoadState('networkidle'); await check(P.page, 'parent', 'auditions-list'); });
await S('tutor auditions: ready/complete', async () => {
  const p = T.page; await p.goto(`${BASE}/tutor/auditions`); await p.waitForLoadState('networkidle'); await check(p, 'tutor', 'auditions-pending');
  await p.getByLabel('Audition video link').first().fill('https://example.com/intro.mp4'); await p.getByRole('button', { name: /mark ready/i }).first().click(); await p.waitForTimeout(1000); await check(p, 'tutor', 'auditions-ready');
  await p.getByRole('button', { name: /mark completed/i }).first().click(); await p.waitForTimeout(1000); await check(p, 'tutor', 'auditions-completed');
  console.log('tutor auditions row:', (await p.locator('tbody').innerText()).replace(/\s+/g, ' ').slice(0, 160));
});
await S('parent sees audition completed', async () => { await P.page.goto(`${BASE}/parent/auditions`); await P.page.waitForLoadState('networkidle'); console.log('parent auditions row:', (await P.page.locator('tbody').innerText()).replace(/\s+/g, ' ').slice(0, 160)); });
await S('decline path', async () => {
  const p = P.page; await p.goto(`${BASE}/parent/browse`); await p.locator('input[placeholder="e.g. Lagos"]').fill(city);
  await p.getByText(tname).waitFor(); await p.getByRole('button', { name: /request audition/i }).first().click(); await p.waitForTimeout(1200);
  const t = T.page; await t.goto(`${BASE}/tutor/auditions`); await t.reload(); await t.waitForLoadState('networkidle');
  await t.getByRole('button', { name: /^decline$/i }).first().click(); await t.waitForTimeout(1000); await check(t, 'tutor', 'audition-declined');
});

// ---- Post a search / Browse requests
await S('post search -> apply -> accept', async () => {
  const p = P.page; await p.goto(`${BASE}/parent/requests`);
  await p.getByLabel('What do you need help with?').fill('Algebra help'); await p.getByLabel('City').fill(city);
  await check(p, 'parent', 'post-search-form');
  await p.getByRole('button', { name: /post request/i }).click(); await p.getByText('Algebra help').first().waitFor({ timeout: 6000 });
  const t = T.page; await t.goto(`${BASE}/tutor/requests`); await t.waitForLoadState('networkidle');
  await t.getByLabel('Filter by city').fill(city).catch(() => {});
  await t.getByText('Algebra help').first().waitFor({ timeout: 6000 });
  await t.getByLabel('Your message').first().fill('I can help'); await t.getByLabel('Proposed rate').first().fill('3000');
  await check(t, 'tutor', 'apply-form');
  await t.getByRole('button', { name: /^apply$/i }).first().click(); await t.waitForTimeout(1200); await check(t, 'tutor', 'applied');
  await p.goto(`${BASE}/parent/requests`); await p.reload(); await p.waitForLoadState('networkidle');
  await p.getByRole('button', { name: /accept \(creates booking\)/i }).first().click(); await p.waitForTimeout(1200); await check(p, 'parent', 'accepted');
  await p.goto(`${BASE}/parent/bookings`); await p.waitForLoadState('networkidle');
  console.log('bookings after accept:', (await p.locator('tbody').innerText()).replace(/\s+/g, ' ').slice(0, 140));
});

// ---- ID verification + admin
const V1 = await signup('parent', 'D4 VerifyOk', { verify: false });
const V2 = await signup('parent', 'D4 VerifyNo', { verify: false });
const png = { name: 'id.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64') };
for (const V of [V1, V2]) await S('upload id ' + V.name, async () => {
  const p = V.page; await p.goto(`${BASE}/verification`); await p.waitForLoadState('networkidle');
  await p.getByLabel('ID photo/scan').setInputFiles(png); await check(p, 'parent', 'id-form');
  await p.getByRole('button', { name: /upload for review/i }).click(); await p.waitForTimeout(1500);
  console.log(V.name, 'verification:', (await p.locator('main').innerText()).replace(/\s+/g, ' ').match(/status[^.]*|pending[^.]*|under review[^.]*/i)?.[0]);
});
const adm = createAdminInDb();
const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const A = await actx.newPage(); watch(A, 'admin');
await A.goto(`${BASE}/login`); await A.locator('#identifier').fill(adm.email); await A.locator('#password').fill(adm.password);
await A.getByRole('button', { name: /sign in/i }).click(); await A.waitForURL(/#\/superadmin/);
await S('admin approve/reject', async () => {
  await A.goto(`${BASE}/superadmin/verifications`); await A.waitForLoadState('networkidle'); await check(A, 'admin', 'verifications');
  const rowOk = A.locator('tr, .lt-card', { hasText: 'D4 VerifyOk' }).last();
  await rowOk.getByRole('button', { name: /approve/i }).click(); await A.waitForTimeout(1200);
  const rowNo = A.locator('tr, .lt-card', { hasText: 'D4 VerifyNo' }).last();
  await rowNo.getByPlaceholder('Rejection reason').fill('Photo unreadable'); await rowNo.getByRole('button', { name: /reject/i }).click(); await A.waitForTimeout(1200); await check(A, 'admin', 'verifications-after');
  console.log('verifications left:', (await A.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 160));
});
await S('verified user status', async () => { await V1.page.goto(`${BASE}/verification`); await V1.page.reload(); await V1.page.waitForLoadState('networkidle'); console.log('V1:', (await V1.page.locator('main').innerText()).replace(/\s+/g, ' ').slice(130, 420)); });
await S('rejected user status', async () => { await V2.page.goto(`${BASE}/verification`); await V2.page.reload(); await V2.page.waitForLoadState('networkidle'); console.log('V2:', (await V2.page.locator('main').innerText()).replace(/\s+/g, ' ').slice(130, 460)); });

await S('admin suspend/reactivate', async () => {
  await A.goto(`${BASE}/superadmin/users`); await A.getByLabel('Search users').fill('D4 VerifyNo'); await A.waitForTimeout(900);
  await A.getByRole('button', { name: /^suspend$/i }).first().click(); await A.waitForTimeout(1000); await check(A, 'admin', 'suspended');
  console.log('after suspend:', (await A.locator('tbody').innerText()).replace(/\s+/g, ' ').slice(0, 120));
  const c = await browser.newContext(); const lp = await c.newPage(); watch(lp, 'suspended-user');
  await lp.goto(`${BASE}/login`); await lp.locator('#identifier').fill(V2.email); await lp.locator('#password').fill('TestPass123'); await lp.getByRole('button', { name: /sign in/i }).click(); await lp.waitForTimeout(1500);
  console.log('suspended login url/msg:', lp.url().replace(/.*#/, ''), (await lp.locator('.lt-error-banner').allInnerTexts()).join('|'));
  await A.getByRole('button', { name: /reactivate/i }).first().click(); await A.waitForTimeout(1000); await check(A, 'admin', 'reactivated');
});
await S('admin view-as', async () => {
  await A.goto(`${BASE}/superadmin/users`); await A.getByLabel('Search users').fill('D4 Parent'); await A.waitForTimeout(900);
  await A.getByRole('button', { name: /view as/i }).first().click(); await A.waitForTimeout(1500); await check(A, 'admin', 'view-as');
  console.log('view-as url:', A.url().replace(/.*#/, ''), (await A.getByText(/Admin view/).count()) ? 'banner ok' : 'NO BANNER');
  await A.getByRole('button', { name: /exit view/i }).click(); await A.waitForTimeout(2000);
});
await S('admin skills add/remove', async () => {
  await A.goto(`${BASE}/superadmin/skills`); const nm = `D4Skill${Date.now()}`;
  await A.locator('#skills-f1').fill(nm); await A.locator('#skills-f2').selectOption({ index: 0 }); await A.getByRole('button', { name: /add skill/i }).click();
  await A.getByText(nm).first().waitFor({ timeout: 5000 }); await check(A, 'admin', 'skill-added');
  await A.locator('tr', { hasText: nm }).getByRole('button', { name: /remove/i }).click(); await A.waitForTimeout(1000);
  console.log('skill removed:', (await A.getByText(nm).count()) === 0);
});
await S('admin settings save', async () => {
  await A.goto(`${BASE}/superadmin/settings`); await A.waitForLoadState('networkidle');
  await A.getByLabel('Platform commission (%)').fill('12'); await A.getByRole('button', { name: /^save$/i }).click(); await A.waitForTimeout(1200); await check(A, 'admin', 'settings-saved');
  console.log('settings msg:', (await A.locator('main').innerText()).match(/saved|updated/i)?.[0]);
});
for (const l of ['schools', 'payouts', 'referrals', 'audit-log']) await S('admin ' + l, async () => { await A.goto(`${BASE}/superadmin/${l}`); await A.waitForLoadState('networkidle'); await check(A, 'admin', l); });
await S('payout button', async () => {
  await A.goto(`${BASE}/superadmin/payouts`); await A.waitForLoadState('networkidle');
  console.log('payout rows/buttons:', await A.locator('tbody tr').count(), await A.getByRole('button').allInnerTexts().then((b) => b.filter((x) => !/log out|resend|✕/i.test(x))));
});

// ---- Account deletion on throwaway
const D = await signup('parent', 'D4 Delete Me');
await S('account delete', async () => {
  const p = D.page; await p.goto(`${BASE}/account`); await check(p, 'delete', 'account');
  await p.getByRole('button', { name: /delete my account/i }).click();
  await p.getByLabel('Enter your password to confirm').fill('TestPass123'); await check(p, 'delete', 'confirm');
  await p.locator('form button[type="submit"]').click(); await p.waitForTimeout(2000);
  console.log('after delete url:', p.url().replace(/.*#/, ''));
});
await browser.close();
console.log(issues.length ? [...new Set(issues)].join('\n') : 'no issues');
