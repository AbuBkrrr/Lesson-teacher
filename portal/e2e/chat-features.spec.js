import { test, expect } from '@playwright/test';
import { uniqueEmail, verifyUserInDb } from './helpers.js';

const API = 'http://localhost:4000/api';
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function signIn(page, email) {
  await page.goto('/#/login');
  await page.locator('#identifier').fill(email);
  await page.locator('#password').fill('supersecret123');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/parent/);
}

test('reply, react, attach a file and set disappearing messages', async ({ page }) => {
  const request = page.request;
  const tutor = await (await request.post(`${API}/auth/signup`, { data: { role: 'tutor', full_name: 'Feat Tutor', email: uniqueEmail('e2e-ft'), password: 'supersecret123' } })).json();
  const parentEmail = uniqueEmail('e2e-fp');
  const parent = await (await request.post(`${API}/auth/signup`, { data: { role: 'parent', full_name: 'Feat Parent', email: parentEmail, password: 'supersecret123' } })).json();
  verifyUserInDb(tutor.user.email); verifyUserInDb(parentEmail);
  const b = await (await request.post(`${API}/bookings`, { headers: auth(parent.access_token), data: { tutor_id: tutor.user.id, subject: 'Feat' } })).json();
  await request.patch(`${API}/bookings/${b.booking.id}/status`, { headers: auth(tutor.access_token), data: { status: 'confirmed' } });
  const conv = await (await request.post(`${API}/conversations`, { headers: auth(parent.access_token), data: { tutor_id: tutor.user.id } })).json();
  await request.post(`${API}/conversations/${conv.conversation.id}/messages`, { headers: auth(tutor.access_token), data: { content: 'Please send the homework' } });

  await signIn(page, parentEmail);
  await page.goto('/#/messages');
  await page.locator('.lt-nav-link', { hasText: 'Feat Tutor' }).click();
  const thread = page.locator('.lt-chat-thread');
  await expect(thread.getByText('Please send the homework')).toBeVisible();

  // react
  await thread.getByRole('button', { name: 'React' }).first().click();
  await thread.getByRole('button', { name: '👍' }).click();
  await expect(thread.getByLabel('1 👍')).toBeVisible();

  // reply
  await thread.getByRole('button', { name: 'Reply' }).first().click();
  await page.getByPlaceholder('Type a message…').fill('Here it is');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(thread.getByText('Here it is')).toBeVisible();
  await expect(thread.getByText('Please send the homework')).toHaveCount(2); // original + quoted

  // attach
  await page.locator('input[type=file]').setInputFiles({ name: 'homework.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 hi') });
  await expect(thread.getByText('homework.pdf')).toBeVisible();

  // disappearing
  await page.getByLabel('Disappearing messages').selectOption('3600');
  await expect(thread.getByText(/disappear after 1 hour/)).toBeVisible();
});

test('a new browser signs in with a code approved from a signed-in one', async ({ page, browser }) => {
  const email = uniqueEmail('e2e-link');
  await page.request.post(`${API}/auth/signup`, { data: { role: 'parent', full_name: 'Link Parent', email, password: 'supersecret123' } });
  verifyUserInDb(email);
  await signIn(page, email);

  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto('/#/login');
  await page2.getByRole('link', { name: /sign in with a code/i }).click();
  const code = (await page2.getByTestId('link-code').textContent()).trim();
  expect(code).toHaveLength(8);

  await page.goto('/#/account');
  await page.getByLabel('Device code').fill(code);
  await page.getByRole('button', { name: 'Link device' }).click();
  await expect(page.locator('.lt-success-banner')).toBeVisible();
  await expect(page2).toHaveURL(/\/parent/, { timeout: 15000 });
  await ctx2.close();
});
