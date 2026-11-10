import { test, expect } from '@playwright/test';
import { uniqueEmail, verifyUserInDb } from './helpers.js';

test.use({ timezoneId: 'Africa/Lagos' });
const API = 'http://localhost:4000/api';

function localInput(daysAhead, hh) {
  const d = new Date(Date.now() + daysAhead * 864e5);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hh)}:00`;
}

test('availability, booking time checks, reschedule and calendar export work end to end', async ({ page, request }) => {
  const city = `SchedCity${Date.now()}`;
  const tname = `Sched Tutor ${Date.now()}`;
  const tEmail = uniqueEmail('e2e-sched-tutor');
  const sign = await request.post(`${API}/auth/signup`, { data: { email: tEmail, password: 'TestPass123', full_name: tname, role: 'tutor' } });
  const tutor = await sign.json();
  verifyUserInDb(tEmail);
  const H = { Authorization: `Bearer ${tutor.access_token}` };
  await request.put(`${API}/tutors/me`, { headers: H, data: { hourly_rate: 3000, currency: 'NGN', city, subjects: [] } });
  const slots = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_time: '10:00', end_time: '12:00' }));
  expect((await request.put(`${API}/tutors/me/availability`, { headers: H, data: { slots, timezone: 'Africa/Lagos' } })).ok()).toBeTruthy();

  const pEmail = uniqueEmail('e2e-sched-parent');
  await page.goto('/#/signup');
  await page.locator('#full_name').fill('Sched Parent');
  await page.locator('#email').fill(pEmail);
  await page.locator('#password').fill('TestPass123');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/parent/);
  verifyUserInDb(pEmail);
  await page.reload();

  await page.goto('/#/parent/browse');
  await page.locator('input[placeholder="e.g. Lagos"]').fill(city);
  await expect(page.getByText(tname)).toBeVisible();
  await expect(page.locator('p', { hasText: 'Teaches:' }).first()).toContainText('10:00–12:00');

  await page.locator('input[id^="findtutor-f6"]').first().fill('Maths');
  // Outside the tutor's hours -> server refuses and the page says why.
  await page.locator('input[id^="findtutor-f7"]').first().fill(localInput(3, 15));
  await page.getByRole('button', { name: /request booking/i }).first().click();
  await expect(page.getByText(/outside the tutor's published availability/i)).toBeVisible();
  // Inside the hours -> accepted.
  await page.locator('input[id^="findtutor-f7"]').first().fill(localInput(3, 11));
  await page.getByRole('button', { name: /request booking/i }).first().click();
  await expect(page.getByText(/booking requested/i)).toBeVisible();

  await page.goto('/#/parent/bookings');
  await expect(page.getByRole('cell', { name: /11:00/ })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /add to calendar/i }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('lesson.ics');

  // The parent moves it to another slot via the inline panel.
  await page.getByRole('button', { name: /^reschedule$/i }).click();
  await page.getByLabel(/date and time/i).fill(localInput(4, 10));
  await page.getByRole('button', { name: /^submit$/i }).click();
  await expect(page.getByText(/lesson time saved/i)).toBeVisible();
  await expect(page.getByRole('cell', { name: /10:00/ })).toBeVisible();
});
