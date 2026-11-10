import { test, expect } from '@playwright/test';
import { uniqueEmail, verifyUserInDb } from './helpers.js';

test('a parent can save a tutor from Browse all and see it on Saved tutors', async ({ page }) => {
  const parentEmail = uniqueEmail('e2e-save-parent');
  const tutorEmail = uniqueEmail('e2e-save-tutor');
  // Unique per run (not just a fixed string) — the dev DB used for e2e
  // persists across runs, so a hardcoded name collides with tutors left
  // behind by earlier runs and breaks the "exactly one match" assumption.
  const tutorName = `E2E Saved Tutor ${Date.now()}`;

  await page.goto('/#/signup');
  await page.locator('input[type="radio"][value="tutor"]').check();
  await page.locator('#full_name').fill(tutorName);
  await page.locator('#email').fill(tutorEmail);
  await page.locator('#password').fill('tutorpass123');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/tutor/);
  verifyUserInDb(tutorEmail);

  // Give the tutor a unique "city" and filter the browse page by it — the
  // dev DB used for e2e persists across runs, so the plain tutor list can
  // run many pages deep and a name match alone isn't guaranteed to land on
  // page 1.
  const uniqueCity = `E2ECity${Date.now()}`;
  await page.goto('/#/tutor');
  await page.locator('input[placeholder="e.g. Lagos"]').fill(uniqueCity);
  await page.getByRole('button', { name: /save profile/i }).click();
  await expect(page.getByText(/profile updated/i)).toBeVisible();

  await page.evaluate(() => localStorage.clear());
  await page.goto('/#/signup');
  await page.locator('#full_name').fill('E2E Saved Parent');
  await page.locator('#email').fill(parentEmail);
  await page.locator('#password').fill('parentpass123');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/parent/);

  await page.goto('/#/parent/browse');
  await page.locator('input[placeholder="e.g. Lagos"]').fill(uniqueCity);
  const card = page.locator('.lt-card', { hasText: tutorName });
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.getByRole('button', { name: /save tutor/i }).click();

  await page.goto('/#/parent/saved');
  await expect(page.getByText(tutorName)).toBeVisible();
});
