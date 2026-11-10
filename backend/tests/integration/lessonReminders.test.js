const request = require('supertest');
const db = require('../../src/config/db');
const { getApp, signupParent, signupTutor, verifyUser } = require('../helpers');
const { runReminderSweep } = require('../../scripts/sendLessonReminders');

const app = getApp();

async function confirmedBooking(scheduledAt, overrides = {}) {
  const { res: tutorRes } = await signupTutor(app, { email: `remindertutor_${Date.now()}_${Math.random()}@example.com`, ...overrides.tutor });
  await verifyUser(tutorRes.body.user.id);
  const { res: parentRes } = await signupParent(app, { email: `reminderparent_${Date.now()}_${Math.random()}@example.com`, ...overrides.parent });
  await verifyUser(parentRes.body.user.id);

  const booking = await request(app).post('/api/bookings')
    .set('Authorization', `Bearer ${parentRes.body.access_token}`)
    .send({ tutor_id: tutorRes.body.user.id, subject: 'Physics', scheduled_at: scheduledAt });
  const bookingId = booking.body.booking.id;

  await request(app).patch(`/api/bookings/${bookingId}/status`)
    .set('Authorization', `Bearer ${tutorRes.body.access_token}`)
    .send({ status: 'confirmed' });

  return { bookingId, parentId: parentRes.body.user.id, tutorId: tutorRes.body.user.id };
}

async function latestNotification(userId, type) {
  return db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1'
  ).get(userId, type);
}

describe('lesson starting soon reminders', () => {
  it('reminds both parties for a booking inside the lookahead window, and is idempotent', async () => {
    const inWindow = new Date(Date.now() + 55 * 60 * 1000).toISOString(); // 55 min out, inside default 45-60 window
    const { bookingId, parentId, tutorId } = await confirmedBooking(inWindow);

    const firstSweep = await runReminderSweep();
    expect(firstSweep).toContain(bookingId);

    const parentNotif = await latestNotification(parentId, 'lesson_starting_soon');
    const tutorNotif = await latestNotification(tutorId, 'lesson_starting_soon');
    expect(parentNotif).toBeDefined();
    expect(tutorNotif).toBeDefined();

    const row = await db.prepare('SELECT reminder_sent_at FROM bookings WHERE id = ?').get(bookingId);
    expect(row.reminder_sent_at).toBeTruthy();

    // A second sweep must not re-notify an already-reminded booking.
    const secondSweep = await runReminderSweep();
    expect(secondSweep).not.toContain(bookingId);
  });

  it('does not remind a booking far outside the window', async () => {
    const farOut = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(); // 5 hours out
    const { bookingId } = await confirmedBooking(farOut);

    const swept = await runReminderSweep();
    expect(swept).not.toContain(bookingId);
  });

  it('skips a booking with an unparseable scheduled_at instead of crashing', async () => {
    // Legacy rows may hold free text from before the API validated times.
    const { bookingId } = await confirmedBooking(new Date(Date.now() + 3600e3).toISOString());
    await db.prepare('UPDATE bookings SET scheduled_at = ? WHERE id = ?').run('next Tuesday afternoon', bookingId);

    await expect(runReminderSweep()).resolves.toBeDefined();
    const row = await db.prepare('SELECT reminder_sent_at FROM bookings WHERE id = ?').get(bookingId);
    expect(row.reminder_sent_at).toBeFalsy();
  });
});
