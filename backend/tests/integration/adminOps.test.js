const request = require('supertest');
const { getApp, signupTutor, signupParent, verifyUser, createSuperAdmin } = require('../helpers');

const app = getApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function adminLogin() {
  const admin = await createSuperAdmin();
  const res = await request(app).post('/api/auth/login').send({ identifier: admin.email, password: admin.password });
  return { token: res.body.access_token, id: res.body.user.id };
}

async function paidBooking() {
  const { res: t } = await signupTutor(app);
  await request(app).put('/api/tutors/me').set(auth(t.body.access_token)).send({ hourly_rate: 5000, currency: 'NGN', subjects: [] });
  const { res: p } = await signupParent(app);
  await verifyUser(t.body.user.id);
  await verifyUser(p.body.user.id);
  const b = await request(app).post('/api/bookings').set(auth(p.body.access_token)).send({ tutor_id: t.body.user.id });
  await request(app).patch(`/api/bookings/${b.body.booking.id}/status`).set(auth(t.body.access_token)).send({ status: 'confirmed' });
  const init = await request(app).post('/api/payments/initialize').set(auth(p.body.access_token)).send({ booking_id: b.body.booking.id });
  await request(app).post('/api/payments/mock/complete').set(auth(p.body.access_token)).send({ reference: init.body.reference });
  await request(app).patch(`/api/bookings/${b.body.booking.id}/status`).set(auth(t.body.access_token)).send({ status: 'completed' });
  return { t, p, bookingId: b.body.booking.id, paymentId: init.body.payment?.id };
}

describe('admin operations', () => {
  it('lists bookings, payments and tutors with names; non-admins are blocked', async () => {
    const admin = await adminLogin();
    const { t, p } = await paidBooking();

    const bookings = await request(app).get('/api/admin/bookings?q=' + encodeURIComponent(p.body.user.full_name)).set(auth(admin.token));
    expect(bookings.status).toBe(200);
    expect(bookings.body.bookings[0]).toMatchObject({ parent_name: p.body.user.full_name, tutor_name: t.body.user.full_name, payment_status: 'successful' });

    const payments = await request(app).get('/api/admin/payments?status=successful').set(auth(admin.token));
    expect(payments.body.payments.length).toBeGreaterThan(0);
    expect(payments.body.payments[0]).toHaveProperty('tutor_name');

    const tutors = await request(app).get('/api/admin/tutors?q=' + encodeURIComponent(t.body.user.full_name)).set(auth(admin.token));
    expect(tutors.body.tutors.map((x) => x.user_id)).toContain(t.body.user.id);

    const denied = await request(app).get('/api/admin/bookings').set(auth(p.body.access_token));
    expect(denied.status).toBe(403);
  });

  it('resolves a refund once, lists it in the queue, and refuses to change a final decision', async () => {
    const admin = await adminLogin();
    const { p, bookingId } = await paidBooking();
    const pay = await request(app).get('/api/payments/mine').set(auth(p.body.access_token));
    const paymentId = pay.body.payments[0].id;
    const created = await request(app).post('/api/refund-requests').set(auth(p.body.access_token)).send({ booking_id: bookingId, payment_id: paymentId, reason: 'Tutor no-show', resolution: 'refund' });
    expect(created.status).toBe(201);

    const queue = await request(app).get('/api/admin/refunds?status=pending').set(auth(admin.token));
    expect(queue.body.refunds.find((r) => r.id === created.body.refund_request.id)).toMatchObject({ requester_name: p.body.user.full_name, amount: 5000 });

    const ok = await request(app).patch(`/api/refund-requests/${created.body.refund_request.id}/resolve`).set(auth(admin.token)).send({ status: 'completed', resolution_note: 'Refunded' });
    expect(ok.status).toBe(200);
    const again = await request(app).patch(`/api/refund-requests/${created.body.refund_request.id}/resolve`).set(auth(admin.token)).send({ status: 'denied' });
    expect(again.status).toBe(409);
  });

  it('suspending a user ends their session immediately and blocks refresh; admins cannot suspend themselves', async () => {
    const admin = await adminLogin();
    const { res: p } = await signupParent(app);
    const ok = await request(app).get('/api/notifications/unread-count').set(auth(p.body.access_token));
    expect(ok.status).toBe(200);

    const sus = await request(app).post(`/api/admin/users/${p.body.user.id}/suspend`).set(auth(admin.token));
    expect(sus.status).toBe(200);
    const blocked = await request(app).get('/api/notifications/unread-count').set(auth(p.body.access_token));
    expect(blocked.status).toBe(403);
    const refresh = await request(app).post('/api/auth/refresh').send({ refresh_token: p.body.refresh_token });
    expect([401, 403]).toContain(refresh.status);

    await request(app).post(`/api/admin/users/${p.body.user.id}/reactivate`).set(auth(admin.token));
    const back = await request(app).get('/api/notifications/unread-count').set(auth(p.body.access_token));
    expect(back.status).toBe(200);

    const self = await request(app).post(`/api/admin/users/${admin.id}/suspend`).set(auth(admin.token));
    expect(self.status).toBe(400);
  });

  it('sends announcements to a role and records them; validates input; resend verification + reset link work', async () => {
    const admin = await adminLogin();
    const { res: p } = await signupParent(app);
    const bad = await request(app).post('/api/admin/announcements').set(auth(admin.token)).send({ audience: 'nope', subject: 'x', body: 'y' });
    expect(bad.status).toBe(400);
    const sent = await request(app).post('/api/admin/announcements').set(auth(admin.token)).send({ audience: 'parent', subject: 'Holiday notice', body: 'No lessons on Friday.' });
    expect(sent.status).toBe(201);
    expect(sent.body.recipients).toBeGreaterThan(0);
    const inbox = await request(app).get('/api/notifications').set(auth(p.body.access_token));
    expect(inbox.body.notifications.map((n) => n.subject)).toContain('Holiday notice');

    const rv = await request(app).post(`/api/admin/users/${p.body.user.id}/resend-verification`).set(auth(admin.token));
    expect(rv.status).toBe(200);
    const pr = await request(app).post(`/api/admin/users/${p.body.user.id}/password-reset`).set(auth(admin.token));
    expect(pr.status).toBe(200);
    const log = await request(app).get('/api/admin/audit-log').set(auth(admin.token));
    expect(log.body.entries.map((e) => e.action)).toEqual(expect.arrayContaining(['announcement.send', 'user.password_reset_sent']));
  });
});

describe('admin dashboard stats', () => {
  it('includes the needs-attention counts and revenue', async () => {
    const admin = await adminLogin();
    const r = await request(app).get('/api/admin/stats').set(auth(admin.token));
    expect(r.status).toBe(200);
    expect(r.body.attention).toEqual(expect.objectContaining({ id_verifications: expect.any(Number), refund_requests: expect.any(Number), transfers_to_confirm: expect.any(Number), tutors_owed: expect.any(Number) }));
    expect(Array.isArray(r.body.revenue)).toBe(true);
  });
});

describe('admin settings validation', () => {
  it('saves all pricing rules and rejects non-numeric or out-of-range values', async () => {
    const admin = await adminLogin();
    const ok = await request(app).patch('/api/admin/settings').set(auth(admin.token)).send({ sibling_discount_percent: 12, satisfaction_guarantee_hours: 72, instant_payout_fee_percent: 3 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ sibling_discount_percent: 12, satisfaction_guarantee_hours: 72, instant_payout_fee_percent: 3 });
    for (const bad of [{ commission_percent: 'abc' }, { commission_percent: 101 }, { satisfaction_guarantee_hours: -1 }, { instant_payout_fee_percent: '' }]) {
      const r = await request(app).patch('/api/admin/settings').set(auth(admin.token)).send(bad);
      expect(r.status).toBe(400);
    }
    await request(app).patch('/api/admin/settings').set(auth(admin.token)).send({ sibling_discount_percent: 10, satisfaction_guarantee_hours: 48, instant_payout_fee_percent: 2 });
  });
});
