import { test, expect } from '@playwright/test';
import { uniqueEmail } from './helpers.js';

test('a tutor can publish a weekly availability slot', async ({ page }) => {
  const email = uniqueEmail('e2e-tutor-avail');

  await page.goto('/#/signup');
  await page.locator('input[type="radio"][value="tutor"]').check();
  await page.locator('#full_name').fill('E2E Tutor');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('tutorpass123');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/tutor/);

  await page.goto('/#/tutor/availability');
  await page.getByRole('button', { name: /add a slot/i }).click();
  await page.locator('#availability-f1-0').selectOption('3'); // Wednesday
  const timeInputs = page.locator('input[type="time"]');
  await timeInputs.nth(0).fill('09:00');
  await timeInputs.nth(1).fill('12:00');
  await page.getByRole('button', { name: /^save availability$/i }).click();

  await expect(page.getByText(/availability updated/i)).toBeVisible();
});
