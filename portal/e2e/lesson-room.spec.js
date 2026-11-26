import fs from 'fs';
import { test, expect, chromium } from '@playwright/test';
import { uniqueEmail, verifyUserInDb } from './helpers.js';

const API = 'http://localhost:4000/api';
// E2E_CHROMIUM lets a machine whose Playwright browsers don't match this
// project's Playwright version point at an installed Chromium instead.
const LOCAL_CHROMIUM = process.env.E2E_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// Fake camera/mic and an auto-accepted screen picker, so a real WebRTC call
// (through the real mediasoup server) can run headless.
const MEDIA_ARGS = [
  '--no-sandbox',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--auto-accept-this-tab-capture',
  '--auto-select-desktop-capture-source=Entire screen',
];

async function signUp(request, role, name) {
  const email = uniqueEmail(`e2e-room-${role}`);
  const res = await request.post(`${API}/auth/signup`, { data: { email, password: 'TestPass123', full_name: name, role } });
  expect(res.ok()).toBeTruthy();
  verifyUserInDb(email);
  return res.json();
}

async function signedInPage(browser, session) {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await context.addInitScript(([user, access, refresh]) => {
    localStorage.setItem('ltp_user_v1', user);
    localStorage.setItem('ltp_access_token_v1', access);
    localStorage.setItem('ltp_refresh_token_v1', refresh);
  }, [JSON.stringify(session.user), session.access_token, session.refresh_token]);
  return context.newPage();
}

test('live lesson: video both ways, screen share, shared whiteboard and saved in-call chat', async ({ request }) => {
  test.setTimeout(90000);
  const tutor = await signUp(request, 'tutor', 'Room Tutor');
  const parent = await signUp(request, 'parent', 'Room Parent');
  const T = { Authorization: `Bearer ${tutor.access_token}` };
  const P = { Authorization: `Bearer ${parent.access_token}` };
  await request.put(`${API}/tutors/me`, { headers: T, data: { hourly_rate: 2500, currency: 'NGN', subjects: [] } });
  const booking = (await (await request.post(`${API}/bookings`, { headers: P, data: { tutor_id: tutor.user.id, subject: 'Fractions' } })).json()).booking;
  await request.patch(`${API}/bookings/${booking.id}/status`, { headers: T, data: { status: 'confirmed' } });
  const pay = await (await request.post(`${API}/payments/initialize`, { headers: P, data: { booking_id: booking.id } })).json();
  expect((await request.post(`${API}/payments/mock/complete`, { headers: P, data: { reference: pay.reference } })).ok()).toBeTruthy();

  const browser = await chromium.launch({ ...(fs.existsSync(LOCAL_CHROMIUM) ? { executablePath: LOCAL_CHROMIUM } : {}), args: MEDIA_ARGS });
  try {
    const tutorPage = await signedInPage(browser, tutor);
    const parentPage = await signedInPage(browser, parent);
    await tutorPage.goto(`/#/lessons/${booking.id}`);
    await parentPage.goto(`/#/lessons/${booking.id}`);

    // Each side receives the other's camera.
    await expect(tutorPage.getByText('Parent', { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(parentPage.getByText('Tutor', { exact: true })).toBeVisible({ timeout: 20000 });
    await expect.poll(() => parentPage.evaluate(() => {
      const v = document.querySelector('.lt-lesson-remote-tile video');
      return v ? v.videoWidth : 0;
    }), { timeout: 20000 }).toBeGreaterThan(0);
    // Opened without a click first, so the browser blocked sound: video still
    // plays muted and the page offers a button to turn sound on.
    const soundBtn = parentPage.getByRole('button', { name: /turn on sound/i });
    if (await soundBtn.count()) {
      await soundBtn.click();
      await expect(soundBtn).toHaveCount(0);
    }

    // Chat: sent by the tutor, seen by the parent, and kept on the server.
    await tutorPage.getByLabel('Chat message').fill('Please open https://example.com/worksheet');
    await tutorPage.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(parentPage.getByRole('link', { name: 'https://example.com/worksheet' })).toBeVisible();
    const log = await (await request.get(`${API}/bookings/${booking.id}/call-chat`, { headers: P })).json();
    expect(log.messages.map((m) => m.body)).toContain('Please open https://example.com/worksheet');

    // Whiteboard: a stroke drawn by the parent appears on the tutor's canvas.
    await parentPage.getByRole('tab', { name: 'Whiteboard' }).click();
    await tutorPage.getByRole('tab', { name: 'Whiteboard' }).click();
    await expect(tutorPage.getByRole('button', { name: 'Clear board' })).toBeVisible();
    await expect(parentPage.getByRole('button', { name: 'Clear board' })).toHaveCount(0); // only the tutor can clear
    const canvas = parentPage.getByLabel('Shared whiteboard');
    const box = await canvas.boundingBox();
    await parentPage.mouse.move(box.x + 40, box.y + 40);
    await parentPage.mouse.down();
    await parentPage.mouse.move(box.x + 200, box.y + 120, { steps: 8 });
    await parentPage.mouse.up();
    const inkPixels = () => tutorPage.evaluate(() => {
      const c = document.querySelector('.lt-wb-surface canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    });
    await expect.poll(inkPixels, { timeout: 10000 }).toBeGreaterThan(50);

    // Screen share: tutor shares, the parent gets a second "screen" tile; stopping removes it.
    await tutorPage.getByRole('button', { name: 'Share screen' }).click();
    await expect(parentPage.getByText('Tutor · screen')).toBeVisible({ timeout: 20000 });
    await tutorPage.getByRole('button', { name: 'Stop sharing' }).click();
    await expect(parentPage.getByText('Tutor · screen')).toHaveCount(0, { timeout: 10000 });

    await tutorPage.screenshot({ path: 'test-results/lesson-room-tutor.png', fullPage: true });
  } finally {
    await browser.close();
  }
});
