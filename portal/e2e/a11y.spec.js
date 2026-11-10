import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { uniqueEmail } from './helpers.js';

// Regression guard for the UX audit (scripts/ux-audit.mjs covers more pages and
// saves screenshots): no serious/critical WCAG A/AA violations, and no
// horizontal scroll at phone width, on the pages people use most.
const PUBLIC = ['/login', '/signup', '/forgot-password'];
const PARENT = ['/parent', '/parent/browse', '/parent/saved', '/parent/children', '/parent/bookings', '/parent/requests', '/messages', '/account'];

async function check(page, path) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/#${path}`);
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const bad = violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id} x${v.nodes.length}`);
  expect(bad, `a11y on ${path}`).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
}

test('public pages are accessible and fit a phone screen', async ({ page }) => {
  for (const p of PUBLIC) await check(page, p);
});

test('parent pages are accessible and fit a phone screen', async ({ page }) => {
  await page.goto('/#/signup');
  await page.locator('#full_name').fill('A11y Parent');
  await page.locator('#email').fill(uniqueEmail('e2e-a11y'));
  await page.locator('#password').fill('supersecret123');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/parent/);
  for (const p of PARENT) await check(page, p);
});
