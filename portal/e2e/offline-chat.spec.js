import { test, expect } from '@playwright/test';
import { uniqueEmail, verifyUserInDb } from './helpers.js';

const API = 'http://localhost:4000/api';

test('a message typed offline is queued, sent once on reconnect, and cached pages still open offline', async ({ page, context, request }) => {
  const tutor = await (await request.post(`${API}/auth/signup`, { data: { role: 'tutor', full_name: 'Offline Tutor', email: uniqueEmail('e2e-off-t'), password: 'supersecret123' } })).json();
  const parentEmail = uniqueEmail('e2e-off-p');
  const parent = await (await request.post(`${API}/auth/signup`, { data: { role: 'parent', full_name: 'Offline Parent', email: parentEmail, password: 'supersecret123' } })).json();
  verifyUserInDb(tutor.user.email); verifyUserInDb(parentEmail);
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const b = await (await request.post(`${API}/bookings`, { headers: auth(parent.access_token), data: { tutor_id: tutor.user.id, subject: 'Offline' } })).json();
  await request.patch(`${API}/bookings/${b.booking.id}/status`, { headers: auth(tutor.access_token), data: { status: 'confirmed' } });
  const conv = await (await request.post(`${API}/conversations`, { headers: auth(parent.access_token), data: { tutor_id: tutor.user.id } })).json();
  await request.post(`${API}/conversations/${conv.conversation.id}/messages`, { headers: auth(tutor.access_token), data: { content: 'Welcome' } });

  await page.goto('/#/login');
  await page.locator('#identifier').fill(parentEmail);
  await page.locator('#password').fill('supersecret123');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/parent/);

  await page.goto('/#/parent/bookings');
  await expect(page.getByRole('heading', { name: 'Bookings' })).toBeVisible();
  await page.goto('/#/messages');
  await page.locator('.lt-nav-link', { hasText: 'Offline Tutor' }).click();
  await expect(page.locator('.lt-chat-thread').getByText('Welcome')).toBeVisible();

  await context.setOffline(true);
  await page.getByPlaceholder('Type a message…').fill('Sent while offline');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.lt-chat-thread').getByText('Sent while offline')).toBeVisible();
  await expect(page.getByText('Waiting to send…')).toBeVisible();
  await expect(page.getByRole('status')).toContainText(/offline/i);

  // A page visited earlier still opens from the device cache.
  await page.getByRole('link', { name: /^.*Account/ }).click();
  await page.goto('/#/parent/bookings');
  await expect(page.getByRole('heading', { name: 'Bookings' })).toBeVisible();

  await context.setOffline(false);
  await page.goto('/#/messages');
  await page.locator('.lt-nav-link', { hasText: 'Offline Tutor' }).click();
  await expect(page.getByText('Waiting to send…')).toHaveCount(0, { timeout: 20000 });

  const all = await (await request.get(`${API}/conversations/${conv.conversation.id}/messages`, { headers: auth(tutor.access_token) })).json();
  expect(all.messages.filter((m) => m.content === 'Sent while offline')).toHaveLength(1);
});
