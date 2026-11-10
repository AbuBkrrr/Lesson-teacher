import { test, expect } from '@playwright/test';
import { uniqueEmail } from './helpers.js';

test('a new parent can sign up and land on their home screen', async ({ page }) => {
  const email = uniqueEmail('e2e-parent');

  await page.goto('/#/signup');
  await page.locator('#full_name').fill('E2E Parent');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('supersecret123');
  await page.getByRole('button', { name: /create account/i }).click();

  // Signed-up parents land on /parent; the layout nav confirms a real session, not just a URL change.
  await expect(page).toHaveURL(/\/parent/);
  await expect(page.getByRole('link', { name: /post a search/i })).toBeVisible();
});
