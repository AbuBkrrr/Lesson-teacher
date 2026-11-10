import { test, expect } from '@playwright/test';
import { uniqueEmail, verifyUserInDb } from './helpers.js';

const API = 'http://localhost:4000/api';

test('a parent can edit then delete their own message', async ({ page }) => {
  const request = page.request;
  const tutor = await (await request.post(`${API}/auth/signup`, { data: { role: 'tutor', full_name: 'Edit Tutor', email: uniqueEmail('e2e-ed-t'), password: 'supersecret123' } })).json();
  const parentEmail = uniqueEmail('e2e-ed-p');
  const parent = await (await request.post(`${API}/auth/signup`, { data: { role: 'parent', full_name: 'Edit Parent', email: parentEmail, password: 'supersecret123' } })).json();
  verifyUserInDb(tutor.user.email); verifyUserInDb(parentEmail);
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const b = await (await request.post(`${API}/bookings`, { headers: auth(parent.access_token), data: { tutor_id: tutor.user.id, subject: 'Edit' } })).json();
  await request.patch(`${API}/bookings/${b.booking.id}/status`, { headers: auth(tutor.access_token), data: { status: 'confirmed' } });
  const conv = await (await request.post(`${API}/conversations`, { headers: auth(parent.access_token), data: { tutor_id: tutor.user.id } })).json();
  await request.post(`${API}/conversations/${conv.conversation.id}/messages`, { headers: auth(parent.access_token), data: { content: 'Typo hree' } });

  await page.goto('/#/login');
  await page.locator('#identifier').fill(parentEmail);
  await page.locator('#password').fill('supersecret123');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/parent/);
  await page.goto('/#/messages');
  await page.locator('.lt-nav-link', { hasText: 'Edit Tutor' }).click();
  const thread = page.locator('.lt-chat-thread');
  await expect(thread.getByText('Typo hree')).toBeVisible();

  await thread.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByPlaceholder('Type a message…').fill('Typo here');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(thread.getByText('Typo here')).toBeVisible();
  await expect(thread.getByText(/edited/)).toBeVisible();

  page.once('dialog', (d) => d.accept());
  await thread.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(thread.getByText('You deleted this message')).toBeVisible();
});
