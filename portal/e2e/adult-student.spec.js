import { test, expect } from '@playwright/test';
import { uniqueEmail, verifyUserInDb } from './helpers.js';

const API = 'http://localhost:4000/api';

async function signup(request, role, name) {
  const email = uniqueEmail(`e2e-adult-${role}`);
  const res = await request.post(`${API}/auth/signup`, {
    data: { email, password: 'TestPass123', full_name: name, role, date_of_birth: '2000-01-01' },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  verifyUserInDb(email);
  return { email, token: body.access_token, id: body.user.id };
}

test('an adult student receives and submits a tutor assignment from the portal', async ({ page, request }) => {
  const tutor = await signup(request, 'tutor', 'E2E Adult Tutor');
  const student = await signup(request, 'adult_student', 'E2E Adult Student');
  const h = (t) => ({ Authorization: `Bearer ${t}` });
  await request.put(`${API}/tutors/me`, { headers: h(tutor.token), data: { hourly_rate: 4000, currency: 'NGN', subjects: [] } });
  const b = await (await request.post(`${API}/bookings`, { headers: h(student.token), data: { tutor_id: tutor.id, subject: 'Maths' } })).json();
  await request.patch(`${API}/bookings/${b.booking.id}/status`, { headers: h(tutor.token), data: { status: 'confirmed' } });
  const title = `E2E task ${Date.now()}`;
  const a = await request.post(`${API}/assignments`, { headers: h(tutor.token), data: { student_user_id: student.id, title, instructions: 'Do it' } });
  expect(a.status()).toBe(201);

  await page.goto('/#/login');
  await page.locator('#identifier').fill(student.email);
  await page.locator('#password').fill('TestPass123');
  await page.getByRole('button', { name: /log in|sign in/i }).click();
  await page.getByRole('link', { name: /assignments/i }).first().click();
  await expect(page.getByText(title)).toBeVisible();
});
