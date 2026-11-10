import { test, expect } from '@playwright/test';
import { uniqueEmail, createAdminInDb } from './helpers.js';

test('a super admin can "view as" a user, then exit, and the audit log records it', async ({ page, browser }) => {
  const parentEmail = uniqueEmail('e2e-impersonated');
  const parentName = `E2E Impersonated ${Date.now()}`;

  const parentCtx = await browser.newContext();
  const parentPage = await parentCtx.newPage();
  await parentPage.goto('/#/signup');
  await parentPage.locator('#full_name').fill(parentName);
  await parentPage.locator('#email').fill(parentEmail);
  await parentPage.locator('#password').fill('parentpass123');
  await parentPage.getByRole('button', { name: /create account/i }).click();
  await expect(parentPage).toHaveURL(/\/parent/);
  await parentCtx.close();

  const admin = createAdminInDb();
  await page.goto('/#/login');
  await page.locator('#identifier').fill(admin.email);
  await page.locator('#password').fill(admin.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/superadmin/);

  await page.goto('/#/superadmin/users');
  const row = page.locator('tr', { hasText: parentEmail });
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.getByRole('button', { name: /view as/i }).click();

  await expect(page.getByText(new RegExp(`signed in as ${parentName}`))).toBeVisible({ timeout: 10000 });
  await expect(page).toHaveURL(/\/parent|#\/$/);

  await page.getByRole('button', { name: /exit view/i }).click();
  await expect(page).toHaveURL(/\/superadmin\/users/);

  await page.goto('/#/superadmin/audit-log');
  await expect(page.getByText('user.impersonate').first()).toBeVisible();
});
