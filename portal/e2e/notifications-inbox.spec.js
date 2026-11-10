import { test, expect } from '@playwright/test';
import { uniqueEmail } from './helpers.js';

test('new users get an in-app notification, with a bell badge that clears on mark-all-read', async ({ page }) => {
  await page.goto('/#/signup');
  await page.locator('input[type="radio"][value="parent"]').check();
  await page.locator('#full_name').fill('Inbox Parent');
  await page.locator('#email').fill(uniqueEmail('e2e-inbox'));
  await page.locator('#password').fill('parentpass123');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/parent/);

  const link = page.getByRole('link', { name: /notifications/i });
  await expect(link.getByLabel(/unread/i)).toBeVisible();
  await link.click();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByRole('button', { name: /verify your email/i }).first()).toBeVisible();

  await page.getByRole('button', { name: /mark all as read/i }).click();
  await expect(link.getByLabel(/unread/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /mark all as read/i })).toBeDisabled();
});
