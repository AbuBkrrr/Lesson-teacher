import { test, expect } from '@playwright/test';
import { uniqueEmail, createAdminInDb } from './helpers.js';

test('admin can use every operations page, suspend a user (who is then locked out) and send an announcement', async ({ page }) => {
  const tag = `Adm${Date.now()}`;
  const parentEmail = uniqueEmail('e2e-adm-parent');
  await page.goto('/#/signup');
  await page.locator('input[type="radio"][value="parent"]').check();
  await page.locator('#full_name').fill(`${tag} Parent`);
  await page.locator('#email').fill(parentEmail);
  await page.locator('#password').fill('parentpass123');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/parent/);

  const admin = createAdminInDb();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/#/login');
  await page.locator('#identifier').fill(admin.email);
  await page.locator('#password').fill(admin.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/superadmin/);

  for (const [path, heading] of [['tutors', 'Tutors'], ['bookings', 'Bookings'], ['payments', 'Payments'], ['refunds', 'Refund requests'], ['announcements', 'Announcements']]) {
    await page.goto(`/#/superadmin/${path}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }

  await page.goto('/#/superadmin/settings');
  await expect(page.getByLabel('Sibling discount (%)')).toBeVisible();
  await expect(page.getByLabel('Instant payout fee (%)')).toBeVisible();

  await page.goto('/#/superadmin/announcements');
  await page.locator('#ann-audience').selectOption('parent');
  await page.locator('#ann-subject').fill(`Hello ${tag}`);
  await page.locator('#ann-body').fill('Test announcement body');
  await page.getByRole('button', { name: 'Send announcement' }).click();
  await page.getByRole('button', { name: /yes, send to parents/i }).click();
  await expect(page.getByRole('status')).toContainText(/Sent to \d+/);

  await page.goto('/#/superadmin/users');
  await page.getByLabel('Search users').fill(tag);
  const row = page.getByRole('row', { name: new RegExp(tag) });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /^suspend/i }).click();
  await row.getByRole('button', { name: /yes, suspend/i }).click();
  await expect(row.getByRole('button', { name: 'Reactivate' })).toBeVisible();

  await page.evaluate(() => { localStorage.clear(); });
  await page.goto('/#/login');
  await page.locator('#identifier').fill(parentEmail);
  await page.locator('#password').fill('parentpass123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText(/suspended/i)).toBeVisible();
});
