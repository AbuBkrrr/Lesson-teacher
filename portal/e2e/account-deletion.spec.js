import { test, expect } from '@playwright/test';
import { uniqueEmail } from './helpers.js';

test('a parent can delete their own account from the Account page', async ({ page }) => {
  const email = uniqueEmail('e2e-delete-parent');
  const password = 'deleteme12345';

  await page.goto('/#/signup');
  await page.locator('#full_name').fill('E2E Delete Parent');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/parent/);

  await page.goto('/#/account');
  await page.getByRole('button', { name: /^delete my account$/i }).click();
  await page.locator('#confirmPassword').fill(password);
  await page.getByRole('button', { name: /confirm permanent deletion/i }).click();

  await expect(page).toHaveURL(/\/login/);

  // The account no longer logs in.
  await page.locator('#identifier').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByText(/invalid credentials/i)).toBeVisible();
});
