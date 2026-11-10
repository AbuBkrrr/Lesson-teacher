import { test, expect } from '@playwright/test';
import { uniqueEmail } from './helpers.js';

test('a new parent sees the getting-started checklist and can dismiss it', async ({ page }) => {
  await page.goto('/#/signup');
  await page.locator('#full_name').fill('E2E Onboard');
  await page.locator('#email').fill(uniqueEmail('e2e-onboard'));
  await page.locator('#password').fill('supersecret123');
  await page.getByRole('button', { name: /create account/i }).click();

  const card = page.getByTestId('getting-started');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Add your child');
  await expect(card).toContainText('Find a tutor');

  await card.getByRole('button', { name: /dismiss/i }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(page.getByTestId('getting-started')).toHaveCount(0);
});
