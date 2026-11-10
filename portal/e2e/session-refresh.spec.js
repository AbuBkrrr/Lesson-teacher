import { test, expect } from '@playwright/test';
import { uniqueEmail } from './helpers.js';

async function signupParent(page) {
  await page.goto('/#/signup');
  await page.locator('input[type="radio"][value="parent"]').check();
  await page.locator('#full_name').fill('Refresh Parent');
  await page.locator('#email').fill(uniqueEmail('e2e-refresh'));
  await page.locator('#password').fill('parentpass123');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/parent/);
}

test('an expired access token is silently refreshed; a dead session returns to Login with a notice', async ({ page }) => {
  await signupParent(page);

  // Simulate the 15-minute access token expiring.
  await page.evaluate(() => localStorage.setItem('ltp_access_token_v1', 'expired.token.value'));
  await page.goto('/#/parent/bookings');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bookings' })).toBeVisible();
  await expect(page.getByText(/invalid or expired token/i)).toHaveCount(0);
  const refreshed = await page.evaluate(() => localStorage.getItem('ltp_access_token_v1'));
  expect(refreshed).not.toBe('expired.token.value');

  // Now lose the refresh token too: the session is over.
  await page.evaluate(() => {
    localStorage.setItem('ltp_access_token_v1', 'expired.token.value');
    localStorage.removeItem('ltp_refresh_token_v1');
  });
  await page.goto('/#/messages');
  await expect(page).toHaveURL(/#\/login/);
  await expect(page.getByText(/session expired/i)).toBeVisible();
});
