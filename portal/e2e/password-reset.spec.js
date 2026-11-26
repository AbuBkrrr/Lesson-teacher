import { test, expect } from '@playwright/test';
import { uniqueEmail, latestResetToken } from './helpers.js';

test('a parent can reset a forgotten password end to end', async ({ page }) => {
  const email = uniqueEmail('e2e-pwreset');

  // Sign up first so there's an account to reset.
  await page.goto('/#/signup');
  await page.locator('#full_name').fill('E2E Reset Parent');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('originalpass123');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/parent/);

  // Log out the way a user does.
  await page.getByRole('button', { name: /log out/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole('link', { name: /forgot your password/i }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
  // The URL changes a moment before the page swaps, and Login has an #identifier
  // field too: wait for the reset page itself before typing.
  await expect(page.getByRole('button', { name: /send reset instructions/i })).toBeVisible();

  await page.locator('#identifier').fill(email);
  await page.getByRole('button', { name: /send reset instructions/i }).click();
  await expect(page.getByText(/we've sent reset instructions/i)).toBeVisible();

  const token = latestResetToken(email);
  expect(token).toBeTruthy();

  await page.goto(`/#/reset-password?token=${token}`);
  await page.locator('#newPassword').fill('brandnewpass456');
  await page.locator('#confirmPassword').fill('brandnewpass456');
  await page.getByRole('button', { name: /^reset password$/i }).click();
  await expect(page.getByText(/password has been reset/i)).toBeVisible();

  // Redirects to login; sign in with the new password to confirm it took.
  await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  await page.locator('#identifier').fill(email);
  await page.locator('#password').fill('brandnewpass456');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/parent/);
});
