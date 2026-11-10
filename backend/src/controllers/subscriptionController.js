const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');
const { getProvider } = require('../services/paymentProviders');

function now() {
  return new Date().toISOString();
}

function addInterval(fromIso, interval) {
  const d = new Date(fromIso);
  if (interval === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

/** GET /api/subscriptions/plans?audience= — public */
async function listPlans(req, res) {
  const { audience } = req.query;
  const rows = audience
    ? await db.prepare('SELECT * FROM subscription_plans WHERE audience = ? AND active = 1 AND deleted_at IS NULL ORDER BY price').all(audience)
    : await db.prepare('SELECT * FROM subscription_plans WHERE active = 1 AND deleted_at IS NULL ORDER BY audience, price').all();
  res.json({ plans: rows });
}

/** POST /api/subscriptions/plans  (super_admin) */
async function createPlan(req, res) {
  const { code, name, audience, price, currency, interval, benefits, booking_discount_percent } = req.body || {};
  if (!code || !name || !audience || price === undefined) {
    return res.status(400).json({ error: 'code, name, audience, and price are required' });
  }
  if (!['parent', 'school'].includes(audience)) return res.status(400).json({ error: "audience must be 'parent' or 'school'" });

  const id = uuidv4();
  const ts = now();
  await db.prepare(
    `INSERT INTO subscription_plans (id, code, name, audience, price, currency, interval, benefits, booking_discount_percent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, code, name, audience, price, currency || 'NGN', interval || 'monthly', JSON.stringify(benefits || []), booking_discount_percent || 0, ts, ts);

  res.status(201).json({ plan: await db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(id) });
}

/**
 * POST /api/subscriptions/subscribe  (parent or school_admin)
 * body: { plan_id }
 * Starts checkout for one billing period. Mirrors the booking-payment
 * flow: a pending row is created now, and POST /:id/confirm (via the
 * configured provider's checkout, or the mock provider for dev/test)
 * activates it for one period from the moment of confirmation.
 */
async function subscribe(req, res) {
  if (!['parent', 'adult_student', 'school_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only parents, adult students, or school admins can subscribe' });
  }

  const { plan_id } = req.body || {};
  const plan = await db.prepare('SELECT * FROM subscription_plans WHERE id = ? AND active = 1 AND deleted_at IS NULL').get(plan_id);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  const expectedAudience = req.user.role === 'school_admin' ? 'school' : 'parent';
  if (plan.audience !== expectedAudience) return res.status(400).json({ error: `This plan is for ${plan.audience}s only` });
  if (expectedAudience === 'school' && !req.user.school_id) return res.status(400).json({ error: 'No school associated with this account' });

  const id = uuidv4();
  const ts = now();
  const provider = getProvider();
  const reference = `sub_${id}`;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  const init = await provider.initializeTransaction({
    amount: plan.price,
    currency: plan.currency,
    email: user.email || `${user.phone}@no-email.lessonteacher.local`,
    reference,
  });

  await db.prepare(
    `INSERT INTO user_subscriptions (id, plan_id, subscriber_user_id, school_id, status, current_period_end, provider, provider_reference, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
  ).run(
    id, plan.id, expectedAudience === 'parent' ? req.user.id : null, expectedAudience === 'school' ? req.user.school_id : null,
    addInterval(ts, plan.interval), provider.name, init.reference, ts, ts
  );

  res.status(201).json({
    subscription_id: id,
    reference: init.reference,
    authorization_url: init.authorization_url,
    plan,
  });
}

/** POST /api/subscriptions/mock/complete  body: { reference } — dev/test only, mirrors payments/mock/complete */
async function mockComplete(req, res) {
  const provider = getProvider();
  if (provider.name !== 'mock') return res.status(400).json({ error: 'Mock completion is only available when PAYMENT_PROVIDER=mock' });

  const { reference } = req.body || {};
  const sub = await db.prepare('SELECT * FROM user_subscriptions WHERE provider_reference = ?').get(reference);
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });

  const ts = now();
  const plan = await db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(sub.plan_id);
  await db
    .prepare('UPDATE user_subscriptions SET status = ?, current_period_end = ?, updated_at = ? WHERE id = ?')
    .run('active', addInterval(ts, plan.interval), ts, sub.id);

  res.json({ ok: true, subscription: await db.prepare('SELECT * FROM user_subscriptions WHERE id = ?').get(sub.id) });
}

/** GET /api/subscriptions/mine  (parent or school_admin) */
async function mine(req, res) {
  let rows;
  if (req.user.role === 'school_admin') {
    rows = await db
      .prepare(
        `SELECT us.*, sp.name AS plan_name, sp.benefits, sp.booking_discount_percent FROM user_subscriptions us
         JOIN subscription_plans sp ON sp.id = us.plan_id
         WHERE us.school_id = ? AND us.deleted_at IS NULL ORDER BY us.created_at DESC`
      )
      .all(req.user.school_id);
  } else if (['parent','adult_student'].includes(req.user.role)) {
    rows = await db
      .prepare(
        `SELECT us.*, sp.name AS plan_name, sp.benefits, sp.booking_discount_percent FROM user_subscriptions us
         JOIN subscription_plans sp ON sp.id = us.plan_id
         WHERE us.subscriber_user_id = ? AND us.deleted_at IS NULL ORDER BY us.created_at DESC`
      )
      .all(req.user.id);
  } else {
    return res.status(403).json({ error: 'Not available for this role' });
  }
  res.json({ subscriptions: rows });
}

/** POST /api/subscriptions/:id/cancel  (the owning parent/school_admin) */
async function cancel(req, res) {
  const { id } = req.params;
  const sub = await db.prepare('SELECT * FROM user_subscriptions WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });

  const isOwner = sub.subscriber_user_id === req.user.id || (sub.school_id && sub.school_id === req.user.school_id);
  if (!isOwner && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Not your subscription' });

  await db.prepare("UPDATE user_subscriptions SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now(), id);
  res.json({ ok: true });
}

module.exports = { listPlans, createPlan, subscribe, mockComplete, mine, cancel };
