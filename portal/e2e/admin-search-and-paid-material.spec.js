import { test, expect } from '@playwright/test';
import { uniqueEmail, verifyUserInDb, createAdminInDb } from './helpers.js';

test('a tutor can price a material and an admin can search users', async ({ page }) => {
  const tag = `Srch${Date.now()}`;
  const email = uniqueEmail('e2e-paid-tutor');
  await page.goto('/#/signup');
  await page.locator('input[type="radio"][value="tutor"]').check();
  await page.locator('#full_name').fill(`${tag} Tutor`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('TestPass123');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/tutor/);
  verifyUserInDb(email);

  await page.goto('/#/tutor/materials');
  await page.getByLabel('Title').fill('Paid worksheet');
  await page.locator('#material-file-input').setInputFiles({ name: 'w.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.getByLabel(/paid material/i).check();
  await page.getByLabel(/price/i).fill('1500');
  await page.getByRole('button', { name: /^upload$/i }).click();
  await expect(page.getByText('NGN 1500')).toBeVisible();

  const admin = createAdminInDb();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.goto('/#/login');
  await page.locator('#identifier').fill(admin.email);
  await page.locator('#password').fill(admin.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/superadmin/);
  await page.goto('/#/superadmin/users');
  await page.getByLabel('Search users').fill(tag);
  await expect(page.getByRole('cell', { name: `${tag} Tutor`, exact: true })).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(2); // header + the single match
});
