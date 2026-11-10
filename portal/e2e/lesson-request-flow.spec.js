import { test, expect } from '@playwright/test';
import { verifyUserInDb, uniqueEmail } from './helpers.js';

// Exercises the full "post a search" flow end-to-end across two browser
// contexts: a parent posts a request, a tutor applies, the parent accepts,
// and a real booking is auto-created and visible to the parent.
test('parent posts a request, tutor applies, parent accepts, and a booking is created', async ({ browser }) => {
  const parentEmail = uniqueEmail('e2e-flow-parent');
  const tutorEmail = uniqueEmail('e2e-flow-tutor');
  const requestTitle = `E2E Algebra tutoring ${Date.now()}`;

  const parentCtx = await browser.newContext();
  const tutorCtx = await browser.newContext();
  const parentPage = await parentCtx.newPage();
  const tutorPage = await tutorCtx.newPage();

  // --- Sign up both accounts ---
  await parentPage.goto('/#/signup');
  await parentPage.locator('#full_name').fill('E2E Flow Parent');
  await parentPage.locator('#email').fill(parentEmail);
  await parentPage.locator('#password').fill('supersecret123');
  await parentPage.getByRole('button', { name: /create account/i }).click();
  await expect(parentPage).toHaveURL(/\/parent/);

  await tutorPage.goto('/#/signup');
  await tutorPage.locator('input[type="radio"][value="tutor"]').click();
  await tutorPage.locator('#full_name').fill('E2E Flow Tutor');
  await tutorPage.locator('#email').fill(tutorEmail);
  await tutorPage.locator('#password').fill('supersecret123');
  await tutorPage.getByRole('button', { name: /create account/i }).click();
  await expect(tutorPage).toHaveURL(/\/tutor/);

  // Bypass the ID-verification hard gate for both accounts (see helpers.js).
  verifyUserInDb(parentEmail);
  verifyUserInDb(tutorEmail);

  // --- Parent posts a request ---
  await parentPage.goto('/#/parent/requests');
  await parentPage.locator('#title').fill(requestTitle);
  await parentPage.locator('#city').fill('Lagos');
  await parentPage.getByRole('button', { name: /^post request$/i }).click();
  await expect(parentPage.getByText(requestTitle)).toBeVisible();

  // --- Tutor browses and applies ---
  await tutorPage.goto('/#/tutor/requests');
  await tutorPage.locator('#city').fill('Lagos');
  const tutorCard = tutorPage.locator('.lt-card', { hasText: requestTitle });
  await expect(tutorCard).toBeVisible();
  await tutorCard.locator('textarea').fill('I can help with this.');
  await tutorCard.getByRole('button', { name: /^apply$/i }).click();
  await expect(tutorCard.getByText(/already applied/i)).toBeVisible();

  // --- Parent accepts the application, which auto-creates a booking ---
  await parentPage.reload();
  const parentCard = parentPage.locator('.lt-card', { hasText: requestTitle });
  await parentCard.getByRole('button', { name: /accept \(creates booking\)/i }).click();
  await expect(parentCard.getByText(/\(accepted\)/i)).toBeVisible();

  await parentPage.goto('/#/parent/bookings');
  await expect(parentPage.getByText('E2E Flow Tutor')).toBeVisible({ timeout: 10000 });

  await parentCtx.close();
  await tutorCtx.close();
});
