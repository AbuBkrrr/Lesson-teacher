import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { uniqueEmail, verifyUserInDb } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHORT = path.join(here, 'fixtures', 'intro-3s.webm');
const TOO_LONG = path.join(here, 'fixtures', 'intro-130s.webm');

test('a tutor adds an intro video under their bio and a parent sees it on the tutor card', async ({ page, browser }) => {
  const tutorName = `E2E Video Tutor ${Date.now()}`;
  const uniqueCity = `VidCity${Date.now()}`;
  const tutorEmail = uniqueEmail('e2e-video-tutor');

  await page.goto('/#/signup');
  await page.locator('input[type="radio"][value="tutor"]').check();
  await page.locator('#full_name').fill(tutorName);
  await page.locator('#email').fill(tutorEmail);
  await page.locator('#password').fill('tutorpass123');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/tutor/);
  verifyUserInDb(tutorEmail);

  await page.locator('input[placeholder="e.g. Lagos"]').fill(uniqueCity);
  await page.getByRole('button', { name: /save profile/i }).click();
  await expect(page.getByText(/profile updated/i)).toBeVisible();

  const editor = page.getByTestId('intro-video-editor');
  await expect(editor).toContainText('1–2 minute');

  // Over two minutes: rejected before any upload.
  await page.locator('#intro-video-input').setInputFiles(TOO_LONG);
  await expect(editor.getByRole('alert')).toContainText(/2 minutes or less/);

  // A short clip: preview, upload, then it shows as the current video.
  await page.locator('#intro-video-input').setInputFiles(SHORT);
  await editor.getByRole('button', { name: /upload video/i }).click();
  await expect(editor.getByText(/current video/i)).toBeVisible();
  await expect(editor.locator('video')).toHaveAttribute('src', /\/uploads\//);

  // A parent browsing by that city sees the video on the card.
  const ctx = await browser.newContext();
  const parent = await ctx.newPage();
  await parent.goto('/#/signup');
  await parent.locator('#full_name').fill('E2E Video Parent');
  await parent.locator('#email').fill(uniqueEmail('e2e-video-parent'));
  await parent.locator('#password').fill('parentpass123');
  await parent.getByRole('button', { name: /create account/i }).click();
  await expect(parent).toHaveURL(/\/parent/);
  await parent.goto('/#/parent/browse');
  await parent.locator('input[placeholder="e.g. Lagos"]').fill(uniqueCity);
  const card = parent.locator('.lt-card', { hasText: tutorName });
  await expect(card).toBeVisible({ timeout: 10000 });
  await expect(card.getByLabel(`Introduction video from ${tutorName}`)).toBeVisible();
  await ctx.close();

  // Removing it works.
  await editor.getByRole('button', { name: /remove video/i }).click();
  await expect(editor.getByText(/current video/i)).toHaveCount(0);
});
