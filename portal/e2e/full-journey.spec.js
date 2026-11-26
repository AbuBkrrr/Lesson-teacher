// One continuous journey through the real UI, from sign-up to a completed,
// paid, reported and reviewed lesson, across tutor, parent, child and admin.
// The only step not done in the UI is creating the first admin account, which
// deliberately has no sign-up page.
import { test, expect } from '@playwright/test';
import { uniqueEmail, createAdminInDb } from './helpers.js';

test.use({ actionTimeout: 15000 });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function localInput(daysAhead, hh) {
  const d = new Date(Date.now() + daysAhead * 864e5);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hh)}:00`;
}

async function signUpInUi(page, role, name, email) {
  await page.goto('/#/signup');
  await page.locator(`input[type="radio"][value="${role}"]`).check();
  await page.locator('#full_name').fill(name);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('TestPass123');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(new RegExp(`#/${role}`));
}

async function uploadId(page) {
  await page.goto('/#/verification');
  await page.locator('#file').setInputFiles({ name: 'id.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Upload for review' }).click();
  await expect(page.getByText(/pending|under review|submitted/i).first()).toBeVisible();
}

test('sign-up to completed, paid, reported and reviewed lesson, through the UI', async ({ browser }) => {
  test.setTimeout(240000);
  const stamp = Date.now();
  const city = `JourneyCity${stamp}`;
  const tutorName = `Journey Tutor ${stamp}`;
  const parentName = `Journey Parent ${stamp}`;
  const tutorEmail = uniqueEmail('journey-tutor');
  const parentEmail = uniqueEmail('journey-parent');
  const tutor = await (await browser.newContext()).newPage();
  const parent = await (await browser.newContext()).newPage();
  const child = await (await browser.newContext()).newPage();
  const admin = await (await browser.newContext()).newPage();

  await test.step('tutor and parent sign up and upload ID', async () => {
    await signUpInUi(tutor, 'tutor', tutorName, tutorEmail);
    await uploadId(tutor);
    await signUpInUi(parent, 'parent', parentName, parentEmail);
    await uploadId(parent);
  });

  await test.step('admin signs in and approves both IDs', async () => {
    const a = createAdminInDb();
    await admin.goto('/#/login');
    await admin.locator('#identifier').fill(a.email);
    await admin.locator('#password').fill(a.password);
    await admin.getByRole('button', { name: /sign in|log in/i }).click();
    await expect(admin).toHaveURL(/#\/superadmin/);
    await admin.goto('/#/superadmin/verifications');
    for (const email of [tutorEmail, parentEmail]) {
      await admin.locator('.lt-card', { hasText: email }).getByRole('button', { name: 'Approve' }).click();
      await expect(admin.locator('.lt-card', { hasText: email })).toHaveCount(0);
    }
  });

  await test.step('tutor fills in profile and skills', async () => {
    await tutor.goto('/#/tutor');
    await tutor.locator('#profile-f2').fill('3000');
    await tutor.locator('#profile-f1-2').fill('Ten years teaching maths and science.');
    await tutor.locator('#profile-f2-2').fill(city);
    await tutor.getByRole('button', { name: 'Save profile' }).click();
    await expect(tutor.getByText('Profile updated.')).toBeVisible();
    await tutor.goto('/#/tutor/skills');
    const row = tutor.locator('.lt-row-between', { hasText: 'Mathematics' });
    await row.getByLabel('Proficiency for Mathematics').selectOption('advanced');
    await row.getByLabel('Evidence links for Mathematics').fill('https://example.com/certificate');
    await row.getByRole('button', { name: 'Add' }).click();
    await expect(row.getByRole('button', { name: 'Remove' })).toBeVisible();
  });

  let inviteCode;
  await test.step('parent adds a child and creates their login code', async () => {
    await parent.goto('/#/parent/children');
    await parent.getByLabel('Full name').fill('Journey Kid');
    await parent.getByLabel('Age').fill('11');
    await parent.getByLabel('Learning needs (optional)').fill('Likes diagrams');
    await parent.getByRole('button', { name: 'Add child' }).click();
    await parent.getByRole('button', { name: 'Give login' }).click();
    await expect(parent.getByRole('img', { name: /QR code/ })).toBeVisible();
    inviteCode = (await parent.locator('.lt-card', { hasText: 'Login code for' }).locator('div').first().innerText()).trim();
    expect(inviteCode).toMatch(/^[A-Z0-9]{4,}$/);
  });

  await test.step('child creates their own login with the code', async () => {
    await child.goto('/#/login');
    await child.getByRole('link', { name: 'Use it here' }).click();
    await child.locator('#code').fill(inviteCode);
    await child.locator("#username").fill(`jkid${String(stamp).slice(-8)}`);
    await child.locator('#childPassword').fill('KidPass1234');
    await child.locator('form').getByRole('button').click();
    await expect(child).not.toHaveURL(/#\/login/);
  });

  await test.step('parent finds the tutor and requests a portfolio audition', async () => {
    await parent.goto('/#/parent/browse');
    await parent.locator('input[placeholder="e.g. Lagos"]').fill(city);
    await expect(parent.getByText(tutorName)).toBeVisible();
    await parent.locator('details.lt-audition-options summary').first().click();
    await parent.locator('select[id^="findtutor-f11"]').first().selectOption('portfolio');
    await parent.getByRole('button', { name: 'Request audition' }).first().click();
    await expect(parent.getByText(/audition requested/i)).toBeVisible();
  });

  await test.step('tutor answers the audition; parent rates and accepts', async () => {
    await tutor.goto('/#/tutor/auditions');
    await tutor.getByLabel('Portfolio link').fill('https://example.com/portfolio');
    await tutor.getByRole('button', { name: 'Send to parent' }).click();
    await expect(tutor.getByText('Sent to the parent.')).toBeVisible();
    await parent.goto('/#/parent/auditions');
    await parent.locator('.lt-stars-input label').nth(4).click();
    await parent.getByRole('button', { name: 'Accept tutor' }).click();
    await expect(parent.getByText(/Accepted — you can now book/)).toBeVisible();
  });

  await test.step('parent books two weekly lessons for the child', async () => {
    await parent.goto('/#/parent/browse');
    await parent.locator('input[placeholder="e.g. Lagos"]').fill(city);
    await expect(parent.getByText(tutorName)).toBeVisible();
    await parent.locator('select[id^="findtutor-f5"]').first().selectOption({ label: 'Journey Kid' });
    await parent.locator('select[id^="findtutor-f8"]').first().selectOption({ label: 'Mathematics' });
    await parent.locator('input[id^="findtutor-f7"]').first().fill(localInput(4, 10));
    await parent.locator('select[id^="findtutor-f10"]').first().selectOption('2');
    await parent.getByRole('button', { name: 'Request booking' }).first().click();
    await expect(parent.getByText('2 weekly lessons requested')).toBeVisible();
  });

  await test.step('tutor confirms the whole series', async () => {
    await tutor.goto('/#/tutor/bookings');
    await tutor.getByRole('button', { name: 'Confirm whole series' }).first().click();
    await expect(tutor.getByRole('button', { name: 'Confirm whole series' })).toHaveCount(0);
    await expect(tutor.getByRole('button', { name: 'Mark completed' })).toHaveCount(2);
  });

  await test.step('parent pays for the first lesson', async () => {
    await parent.goto('/#/parent/bookings');
    await parent.getByRole('button', { name: 'Pay now' }).first().click();
    await parent.getByRole('button', { name: 'Card' }).click();
    await parent.getByRole('button', { name: 'Simulate successful payment' }).click();
    await expect(parent.getByRole('button', { name: 'Pay now' })).toHaveCount(1);
    await expect(parent.getByRole('button', { name: 'Join lesson' })).toHaveCount(1);
  });

  await test.step('tutor writes the report and completes the paid lesson', async () => {
    await tutor.goto('/#/tutor/bookings');
    await tutor.reload(); // already on this page from the previous step
    const paidRow = tutor.locator('tr', { has: tutor.getByRole('button', { name: 'Join lesson' }) });
    await paidRow.getByRole('button', { name: 'Lesson report' }).click();
    await tutor.getByLabel('What you covered (required)').fill('Long division with remainders');
    await tutor.getByLabel('Score (0–100)').fill('85');
    await tutor.getByRole('button', { name: 'Save report' }).click();
    await expect(tutor.getByText('Report saved.')).toBeVisible();
    await tutor.getByRole('button', { name: 'Close' }).click();
    await paidRow.getByRole('button', { name: 'Mark completed' }).click();
    await expect(tutor.getByRole('button', { name: 'Mark completed' })).toHaveCount(1);
  });

  await test.step('parent reviews the lesson and messages the tutor', async () => {
    await parent.goto('/#/parent/bookings');
    await parent.reload(); // already on this page from the payment step
    await parent.getByRole('button', { name: 'Leave review' }).click();
    await parent.locator('#panel-rating').selectOption('5');
    await parent.locator('#panel-comment').fill('Brilliant first lesson');
    await parent.getByRole('button', { name: 'Submit' }).click();
    await expect(parent.getByRole('button', { name: 'Leave review' })).toHaveCount(0);
    await parent.getByRole('button', { name: 'Message' }).first().click();
    await expect(parent).toHaveURL(/#\/messages/);
    await parent.locator('form input:not([type="file"])').last().fill('Thank you, see you next week!');
    await parent.getByRole('button', { name: 'Send', exact: true }).click();
    await tutor.goto('/#/messages');
    await tutor.getByText(parentName).first().click();
    await expect(tutor.getByText('Thank you, see you next week!').last()).toBeVisible();
  });

  await test.step('progress shows for parent and child', async () => {
    await parent.goto('/#/parent/progress');
    await expect(parent.getByText('Long division with remainders')).toBeVisible();
    await expect(parent.locator('.lt-stat', { hasText: 'Lessons completed' })).toContainText('1');
    await child.goto('/#/my-progress');
    await expect(child.getByText('Long division with remainders')).toBeVisible();
  });

  await test.step('admin sees the bookings and the payment', async () => {
    await admin.goto('/#/superadmin/bookings');
    await expect(admin.getByText(parentName).first()).toBeVisible();
    await admin.goto('/#/superadmin/payments');
    await admin.getByLabel('Filter by status').selectOption('successful');
    await expect(admin.getByText(parentName).first()).toBeVisible();
  });
});
