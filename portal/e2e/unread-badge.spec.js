import { test, expect } from '@playwright/test';
import { uniqueEmail, verifyUserInDb } from './helpers.js';

const API_BASE = 'http://localhost:4000/api';

// Sets up a confirmed booking + a parent_tutor message via direct API calls
// (cheaper than driving the whole booking flow through the UI just to get
// to a state where a message exists), then verifies the nav badge in the
// browser reflects and clears the unread count.
test('the Messages nav badge shows and clears an unread count', async ({ page, request }) => {
  const tutorEmail = uniqueEmail('e2e-badge-tutor');
  const parentEmail = uniqueEmail('e2e-badge-parent');

  const tutorBody = await (await request.post(`${API_BASE}/auth/signup`, {
    data: { role: 'tutor', full_name: 'Badge Tutor', email: tutorEmail, password: 'supersecret123' },
  })).json();
  const parentBody = await (await request.post(`${API_BASE}/auth/signup`, {
    data: { role: 'parent', full_name: 'Badge Parent', email: parentEmail, password: 'supersecret123' },
  })).json();

  verifyUserInDb(tutorEmail);
  verifyUserInDb(parentEmail);

  const booking = await request.post(`${API_BASE}/bookings`, {
    headers: { Authorization: `Bearer ${parentBody.access_token}` },
    data: { tutor_id: tutorBody.user.id, subject: 'Badge Test' },
  });
  const bookingBody = await booking.json();
  await request.patch(`${API_BASE}/bookings/${bookingBody.booking.id}/status`, {
    headers: { Authorization: `Bearer ${tutorBody.access_token}` },
    data: { status: 'confirmed' },
  });

  const conv = await request.post(`${API_BASE}/conversations`, {
    headers: { Authorization: `Bearer ${parentBody.access_token}` },
    data: { tutor_id: tutorBody.user.id },
  });
  const convBody = await conv.json();
  await request.post(`${API_BASE}/conversations/${convBody.conversation.id}/messages`, {
    headers: { Authorization: `Bearer ${parentBody.access_token}` },
    data: { content: 'Hello from the badge test' },
  });

  // Log the tutor into the actual browser UI and check the badge.
  await page.goto('/#/login');
  await page.locator('#identifier').fill(tutorBody.user.email);
  await page.locator('#password').fill('supersecret123');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/tutor/);

  const messagesLink = page.getByRole('link', { name: /messages/i });
  await expect(messagesLink.getByText('1')).toBeVisible({ timeout: 25000 });

  await messagesLink.click();
  await expect(page).toHaveURL(/\/messages/);
  await page.locator('.lt-nav-link', { hasText: 'Badge Parent' }).click();

  await expect(messagesLink.getByText('1')).not.toBeVisible({ timeout: 25000 });
});
