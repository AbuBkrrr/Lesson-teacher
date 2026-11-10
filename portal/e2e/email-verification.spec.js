import { test, expect } from '@playwright/test';
import { uniqueEmail, latestVerifyEmailToken } from './helpers.js';

test('a new parent sees a verify-email banner, and the emailed link verifies them', async ({ page }) => {
  const email = uniqueEmail('e2e-verify');

  await page.goto('/#/signup');
  await page.locator('#full_name').fill('E2E Verify Parent');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('originalpass123');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/parent/);

  // Unverified accounts see the resend banner on every portal page.
  await expect(page.getByText(/please verify your email address/i)).toBeVisible();

  const token = latestVerifyEmailToken(email);
  expect(token).toBeTruthy();

  await page.goto(`/#/verify-email?token=${token}`);
  await expect(page.getByText(/email address is verified/i)).toBeVisible();
});
