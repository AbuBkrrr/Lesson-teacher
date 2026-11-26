import { test, expect } from '@playwright/test';
import { uniqueEmail, verifyUserInDb } from './helpers.js';

test.use({ actionTimeout: 10000 });
const API = 'http://localhost:4000/api';

async function signUp(request, role, name) {
  const email = uniqueEmail(`e2e-prog-${role}`);
  const res = await request.post(`${API}/auth/signup`, { data: { email, password: 'TestPass123', full_name: name, role } });
  expect(res.ok()).toBeTruthy();
  verifyUserInDb(email);
  return res.json();
}

async function asUser(page, session) {
  await page.addInitScript(([user, access, refresh]) => {
    localStorage.setItem('ltp_user_v1', user);
    localStorage.setItem('ltp_access_token_v1', access);
    localStorage.setItem('ltp_refresh_token_v1', refresh);
  }, [JSON.stringify(session.user), session.access_token, session.refresh_token]);
}

test('child profile, challenge audition review, tutor report and progress page', async ({ browser, request }) => {
  test.setTimeout(90000);
  const tutor = await signUp(request, 'tutor', `Prog Tutor ${Date.now()}`);
  const parent = await signUp(request, 'parent', 'Prog Parent');
  const T = { Authorization: `Bearer ${tutor.access_token}` };
  const P = { Authorization: `Bearer ${parent.access_token}` };
  await request.put(`${API}/tutors/me`, { headers: T, data: { hourly_rate: 3000, currency: 'NGN', subjects: [] } });
  const skill = (await (await request.get(`${API}/skills`)).json()).skills[0];
  expect(skill).toBeTruthy();

  // Parent adds a child with the new profile fields through the UI.
  const parentPage = await browser.newPage();
  await asUser(parentPage, parent);
  await parentPage.goto('/#/parent/children');
  await parentPage.getByLabel('Full name').fill('Zara');
  await parentPage.getByLabel('Age').fill('9');
  await parentPage.getByLabel('School (optional)').fill('Hill Primary');
  await parentPage.getByLabel('Learning needs (optional)').fill('Prefers visual examples');
  await parentPage.getByRole('button', { name: 'Add child' }).click();
  await expect(parentPage.getByText('Needs: Prefers visual examples')).toBeVisible();
  const child = (await (await request.get(`${API}/children/mine`, { headers: P })).json()).children[0];

  // Challenge audition: tutor answers in the UI, parent rates and accepts in the UI.
  const aud = await (await request.post(`${API}/auditions`, { headers: P, data: { tutor_id: tutor.user.id, type: 'challenge', brief: 'Explain halves', child_id: child.id, skill_id: skill.id } })).json();
  expect(aud.audition.type).toBe('challenge');
  const tutorPage = await browser.newPage();
  await asUser(tutorPage, tutor);
  await tutorPage.goto('/#/tutor/auditions');
  await expect(tutorPage.getByText('Challenge: Explain halves')).toBeVisible();
  await tutorPage.getByLabel('Link to your answer').fill('https://example.com/halves');
  await tutorPage.getByRole('button', { name: 'Send to parent' }).click();
  await expect(tutorPage.getByText('Sent to the parent.')).toBeVisible();

  await parentPage.goto('/#/parent/auditions');
  await parentPage.locator('.lt-stars-input label').nth(3).click();
  await expect(parentPage.getByRole('radio', { name: '4 stars' })).toBeChecked();
  await parentPage.getByLabel('Feedback for the tutor (optional)').fill('Very clear');
  await parentPage.getByRole('button', { name: 'Accept tutor' }).click();
  await expect(parentPage.getByText(/Accepted — you can now book/)).toBeVisible();
  await expect(parentPage.getByLabel('4 out of 5')).toBeVisible();

  // Lesson: book, confirm, pay, tutor writes a report in the UI, completes.
  const b = (await (await request.post(`${API}/bookings`, { headers: P, data: { tutor_id: tutor.user.id, child_id: child.id, skill_id: skill.id, scheduled_at: new Date(Date.now() + 2 * 864e5).toISOString() } })).json()).booking;
  await request.patch(`${API}/bookings/${b.id}/status`, { headers: T, data: { status: 'confirmed' } });
  const pay = await (await request.post(`${API}/payments/initialize`, { headers: P, data: { booking_id: b.id } })).json();
  await request.post(`${API}/payments/mock/complete`, { headers: P, data: { reference: pay.reference } });

  await tutorPage.goto('/#/tutor/bookings');
  await tutorPage.getByRole('button', { name: 'Lesson report' }).first().click();
  await tutorPage.getByLabel('What you covered (required)').fill('Halves and quarters with paper folding');
  await tutorPage.getByLabel('Homework').fill('Fold 3 shapes');
  await tutorPage.getByLabel('Score (0–100)').fill('90');
  await tutorPage.getByRole('button', { name: 'Save report' }).click();
  await expect(tutorPage.getByText('Report saved.')).toBeVisible();
  await request.patch(`${API}/bookings/${b.id}/status`, { headers: T, data: { status: 'completed' } });

  await parentPage.goto(`/#/parent/progress?child=${child.id}`);
  await expect(parentPage.getByText('Halves and quarters with paper folding')).toBeVisible();
  await expect(parentPage.getByText('Homework:')).toBeVisible();
  await expect(parentPage.getByLabel(`${skill.name} level`)).toBeVisible();
  await expect(parentPage.locator('.lt-stat', { hasText: 'Lessons completed' })).toContainText('1');
  await parentPage.screenshot({ path: 'test-results/progress-page.png', fullPage: true });
});
