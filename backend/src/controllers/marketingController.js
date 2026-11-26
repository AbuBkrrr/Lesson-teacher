const crypto = require('crypto');
const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');
const { getSetting, setSetting } = require('../utils/settings');
const { getEmailProvider } = require('../services/notificationProviders/email');
const { clip, resolveDevice, parseUserAgent, locate, hashIp, recordOpen, verdict } = require('../services/marketing');
const { logAdminAction } = require('../services/auditLog');

const CHANNELS = ['whatsapp', 'facebook', 'instagram', 'x', 'linkedin', 'tiktok', 'telegram', 'youtube', 'email', 'sms', 'print', 'website', 'other'];
const AUDIENCES = ['any', 'parent', 'tutor', 'school'];
const LANGUAGES = ['en', 'fr', 'es', 'pt'];
const INTERESTS = ['parent', 'tutor', 'school', 'other'];
const PIXEL_KEYS = { meta_pixel_id: /^\d{6,20}$/, google_tag_id: /^(G|AW|GT)-[A-Z0-9]{4,20}$/, tiktok_pixel_id: /^[A-Z0-9]{10,30}$/ };
const NO_LABEL = '(no label)';

function now() { return new Date().toISOString(); }

function portalUrl() {
  return (process.env.PORTAL_URL || 'http://localhost:5173').replace(/\/$/, '');
}
function linkUrl(slug) { return `${portalUrl()}/#/go/${slug}`; }

async function newSlug() {
  for (let i = 0; i < 10; i++) {
    const slug = crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, '').slice(0, 7).toLowerCase();
    if (slug.length < 6) continue;
    const taken = await db.prepare('SELECT 1 FROM marketing_links WHERE slug = ?').get(slug);
    if (!taken) return slug;
  }
  throw new Error('Could not generate a link code');
}

/** Date range filter from ?from=&to= (ISO dates), default last 90 days. */
function range(req) {
  const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : new Date();
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00Z`) : new Date(to.getTime() - 90 * 864e5);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { error: 'from/to must be dates like 2026-11-01' };
  return { from: from.toISOString(), to: to.toISOString() };
}

// ---------------------------------------------------------------- public

/** GET /api/marketing/public-config — ad tag IDs for the pitch page (loaded only after cookie consent). */
async function publicConfig(req, res) {
  const out = {};
  for (const k of Object.keys(PIXEL_KEYS)) out[k] = (await getSetting(k)) || null;
  res.json(out);
}

/**
 * POST /api/marketing/open — the pitch page reports an open.
 * body: { slug?, device_id?, model?, screen?, timezone?, language?, referrer?, utm?: {source,medium,campaign,content,term} }
 */
async function open(req, res) {
  const b = req.body || {};
  let link = null;
  if (b.slug) {
    link = await db.prepare('SELECT * FROM marketing_links WHERE slug = ?').get(String(b.slug).toLowerCase().slice(0, 32));
    if (!link) return res.status(404).json({ error: 'This link is not valid' });
  }
  const userAgent = req.get('user-agent') || '';
  const ua = parseUserAgent(userAgent);
  const device = resolveDevice({ device_id: b.device_id, model: clip(b.model, 80), screen: clip(b.screen, 20), timezone: clip(b.timezone, 60), language: clip(b.language, 20), userAgent });
  const geo = await locate(req.ip);
  const utm = b.utm && typeof b.utm === 'object' ? b.utm : {};

  const result = await recordOpen({
    id: uuidv4(),
    link_id: link ? link.id : null,
    device_key: device.key,
    device_source: device.source,
    device_type: ua.device_type,
    os: ua.os,
    os_version: ua.os_version,
    browser: ua.browser,
    in_app: ua.in_app,
    device_model: clip(b.model, 80) || ua.device_model,
    screen: clip(b.screen, 20),
    timezone: clip(b.timezone, 60),
    language: clip(b.language, 20),
    referrer: clip(b.referrer, 300),
    utm_source: clip(utm.source, 100),
    utm_medium: clip(utm.medium, 100),
    utm_campaign: clip(utm.campaign, 100),
    utm_content: clip(utm.content, 100),
    utm_term: clip(utm.term, 100),
    ip_hash: hashIp(req.ip),
    ...geo,
    created_at: now(),
  });

  res.status(201).json({
    ...result,
    link: link ? { label: link.label, audience: link.audience, language: link.language, active: !!link.is_active } : null,
  });
}

/** POST /api/marketing/leads — demo / call-back request from the pitch page. */
async function createLead(req, res) {
  const b = req.body || {};
  const full_name = clip(b.full_name, 120);
  const email = clip(b.email, 200);
  const phone = clip(b.phone, 40);
  const interest = INTERESTS.includes(b.interest) ? b.interest : 'parent';
  if (!full_name) return res.status(400).json({ error: 'Please enter your name' });
  if (!email && !phone) return res.status(400).json({ error: 'Please give an email address or a phone number so we can reach you' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'That email address does not look right' });
  if (phone && !/^\+?[\d\s()-]{6,20}$/.test(phone)) return res.status(400).json({ error: 'That phone number does not look right' });

  let link = null;
  if (b.slug) link = await db.prepare('SELECT * FROM marketing_links WHERE slug = ?').get(String(b.slug).toLowerCase().slice(0, 32));
  const device = resolveDevice({ device_id: b.device_id, model: clip(b.model, 80), screen: clip(b.screen, 20), timezone: clip(b.timezone, 60), language: clip(b.language, 20), userAgent: req.get('user-agent') });
  const opens = await db.prepare('SELECT COUNT(*) AS n FROM marketing_opens WHERE device_key = ?').get(device.key);
  const geo = await locate(req.ip);

  const id = uuidv4();
  await db.prepare(
    `INSERT INTO marketing_leads (id, link_id, device_key, full_name, email, phone, interest, message, consent_marketing,
       unsubscribe_token, opens_before, country, city, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, link ? link.id : null, device.key, full_name, email ? email.toLowerCase() : null, phone, interest, clip(b.message, 1000),
    b.consent_marketing ? 1 : 0, crypto.randomBytes(16).toString('hex'), Number(opens.n) || 0, geo.country || null, geo.city || null, now());
  res.status(201).json({ ok: true, id });
}

/** GET /api/marketing/unsubscribe/:token — one-click unsubscribe from follow-up e-mails. */
async function unsubscribe(req, res) {
  const lead = await db.prepare('SELECT id FROM marketing_leads WHERE unsubscribe_token = ?').get(String(req.params.token || ''));
  if (!lead) return res.status(404).json({ error: 'This unsubscribe link is not valid' });
  await db.prepare('UPDATE marketing_leads SET consent_marketing = 0, unsubscribed_at = COALESCE(unsubscribed_at, ?) WHERE id = ?').run(now(), lead.id);
  res.json({ ok: true });
}

/** Called after sign-up: credit the account to the link/device it came from, and mark matching leads converted. */
async function recordSignupAttribution(user, attribution) {
  if (!attribution || typeof attribution !== 'object') return;
  const { DEVICE_ID_RE } = require('../services/marketing');
  let linkId = null;
  if (attribution.slug) {
    const link = await db.prepare('SELECT id FROM marketing_links WHERE slug = ?').get(String(attribution.slug).toLowerCase().slice(0, 32));
    linkId = link ? link.id : null;
  }
  const deviceKey = typeof attribution.device_id === 'string' && DEVICE_ID_RE.test(attribution.device_id) ? `id:${attribution.device_id}` : null;
  if (!linkId && !deviceKey) return;
  await db.prepare('UPDATE users SET signup_link_id = ?, signup_device_key = ? WHERE id = ?').run(linkId, deviceKey, user.id);
  const conds = [];
  const args = [];
  if (deviceKey) { conds.push('device_key = ?'); args.push(deviceKey); }
  if (user.email) { conds.push('lower(email) = lower(?)'); args.push(user.email); }
  if (conds.length) {
    await db.prepare(`UPDATE marketing_leads SET converted_user_id = ? WHERE converted_user_id IS NULL AND (${conds.join(' OR ')})`).run(user.id, ...args);
  }
}

// ---------------------------------------------------------------- admin

/** POST /api/marketing/links  body: { label, campaign?, channel?, audience?, language?, notes? } */
async function createLink(req, res) {
  const b = req.body || {};
  const label = clip(b.label, 80);
  if (!label) return res.status(400).json({ error: 'Give the link a label, e.g. "Lagos school flyers"' });
  const channel = CHANNELS.includes(b.channel) ? b.channel : 'other';
  const audience = AUDIENCES.includes(b.audience) ? b.audience : 'any';
  const language = LANGUAGES.includes(b.language) ? b.language : 'en';
  const id = uuidv4();
  const ts = now();
  const slug = await newSlug();
  await db.prepare(
    `INSERT INTO marketing_links (id, slug, label, campaign, channel, audience, language, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, slug, label, clip(b.campaign, 80), channel, audience, language, clip(b.notes, 500), req.user.id, ts, ts);
  await logAdminAction(req.user.id, 'marketing.link_created', { targetType: 'marketing_link', targetId: id, details: { label, channel } });
  const link = await db.prepare('SELECT * FROM marketing_links WHERE id = ?').get(id);
  res.status(201).json({ link: { ...link, url: linkUrl(slug) } });
}

/** PATCH /api/marketing/links/:id  body: { label?, campaign?, notes?, is_active? } */
async function updateLink(req, res) {
  const link = await db.prepare('SELECT * FROM marketing_links WHERE id = ?').get(req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  const b = req.body || {};
  const label = b.label !== undefined ? clip(b.label, 80) : link.label;
  if (!label) return res.status(400).json({ error: 'Label cannot be empty' });
  const isActive = b.is_active === undefined ? link.is_active : (b.is_active ? 1 : 0);
  await db.prepare('UPDATE marketing_links SET label = ?, campaign = ?, notes = ?, is_active = ?, updated_at = ? WHERE id = ?')
    .run(label, b.campaign !== undefined ? clip(b.campaign, 80) : link.campaign, b.notes !== undefined ? clip(b.notes, 500) : link.notes, isActive, now(), link.id);
  const updated = await db.prepare('SELECT * FROM marketing_links WHERE id = ?').get(link.id);
  res.json({ link: { ...updated, url: linkUrl(updated.slug) } });
}

/**
 * GET /api/marketing/overview?from=&to=
 * Totals, the per-link "same device or shared?" table, funnel and breakdowns.
 */
async function overview(req, res) {
  const r = range(req);
  if (r.error) return res.status(400).json({ error: r.error });
  const inRange = 'o.created_at BETWEEN ? AND ?';

  const totals = await db.prepare(
    `SELECT COUNT(*) AS opens, COUNT(DISTINCT o.device_key) AS devices,
            SUM(CASE WHEN o.open_no > 1 THEN 1 ELSE 0 END) AS repeat_opens
       FROM marketing_opens o WHERE ${inRange}`
  ).get(r.from, r.to);
  const leadTotals = await db.prepare(
    `SELECT COUNT(*) AS leads, SUM(CASE WHEN consent_marketing = 1 THEN 1 ELSE 0 END) AS consented,
            SUM(CASE WHEN converted_user_id IS NOT NULL THEN 1 ELSE 0 END) AS converted
       FROM marketing_leads WHERE created_at BETWEEN ? AND ?`
  ).get(r.from, r.to);
  const signups = await db.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE (signup_link_id IS NOT NULL OR signup_device_key IS NOT NULL) AND created_at BETWEEN ? AND ?`
  ).get(r.from, r.to);

  // One row per link (and one "(no label)" row for opens of the plain pitch page).
  const linkRows = await db.prepare(
    `SELECT l.id, l.slug, l.label, l.campaign, l.channel, l.audience, l.language, l.is_active, l.created_at,
            COUNT(o.id) AS opens, COUNT(DISTINCT o.device_key) AS devices,
            COALESCE(SUM(CASE WHEN o.open_no > 1 THEN 1 ELSE 0 END), 0) AS repeat_opens,
            MAX(o.created_at) AS last_open_at
       FROM marketing_links l
       LEFT JOIN marketing_opens o ON o.link_id = l.id AND ${inRange}
      GROUP BY l.id ORDER BY l.created_at DESC`
  ).all(r.from, r.to);
  const noLink = await db.prepare(
    `SELECT COUNT(*) AS opens, COUNT(DISTINCT o.device_key) AS devices,
            COALESCE(SUM(CASE WHEN o.open_no > 1 THEN 1 ELSE 0 END), 0) AS repeat_opens, MAX(o.created_at) AS last_open_at
       FROM marketing_opens o WHERE o.link_id IS NULL AND ${inRange}`
  ).get(r.from, r.to);
  const leadsByLink = Object.fromEntries((await db.prepare(
    `SELECT COALESCE(link_id, '') AS link_id, COUNT(*) AS n FROM marketing_leads WHERE created_at BETWEEN ? AND ? GROUP BY link_id`
  ).all(r.from, r.to)).map((x) => [x.link_id, Number(x.n)]));
  const signupsByLink = Object.fromEntries((await db.prepare(
    `SELECT signup_link_id AS link_id, COUNT(*) AS n FROM users WHERE signup_link_id IS NOT NULL AND created_at BETWEEN ? AND ? GROUP BY signup_link_id`
  ).all(r.from, r.to)).map((x) => [x.link_id, Number(x.n)]));

  const shape = (row, extra) => {
    const opens = Number(row.opens) || 0;
    const devices = Number(row.devices) || 0;
    return {
      ...extra,
      opens, devices, repeat_opens: Number(row.repeat_opens) || 0,
      verdict: verdict(opens, devices),
      last_open_at: row.last_open_at || null,
    };
  };
  const links = linkRows.map((l) => shape(l, {
    id: l.id, slug: l.slug, url: linkUrl(l.slug), label: l.label, campaign: l.campaign, channel: l.channel,
    audience: l.audience, language: l.language, is_active: !!l.is_active, created_at: l.created_at,
    leads: leadsByLink[l.id] || 0, signups: signupsByLink[l.id] || 0,
  }));
  if (Number(noLink.opens) > 0 || leadsByLink['']) {
    links.push(shape(noLink, { id: null, slug: null, url: `${portalUrl()}/#/go`, label: NO_LABEL, campaign: null, channel: null, leads: leadsByLink[''] || 0, signups: 0 }));
  }

  const breakdown = async (col) => (await db.prepare(
    `SELECT COALESCE(NULLIF(${col}, ''), 'Unknown') AS key, COUNT(*) AS opens, COUNT(DISTINCT device_key) AS devices
       FROM marketing_opens o WHERE ${inRange} GROUP BY 1 ORDER BY opens DESC LIMIT 15`
  ).all(r.from, r.to)).map((x) => ({ key: x.key, opens: Number(x.opens), devices: Number(x.devices) }));

  const [countries, cities, deviceTypes, oses, browsers, inApps, languages, channels] = await Promise.all([
    breakdown('o.country'),
    breakdown("CASE WHEN o.city IS NULL OR o.city = '' THEN NULL ELSE o.city || ', ' || COALESCE(o.country, '') END"),
    breakdown('o.device_type'),
    breakdown('o.os'),
    breakdown('o.browser'),
    breakdown('o.in_app'),
    breakdown('o.language'),
    (async () => (await db.prepare(
      `SELECT COALESCE(l.channel, 'direct') AS key, COUNT(*) AS opens, COUNT(DISTINCT o.device_key) AS devices
         FROM marketing_opens o LEFT JOIN marketing_links l ON l.id = o.link_id
        WHERE ${inRange} GROUP BY 1 ORDER BY opens DESC`
    ).all(r.from, r.to)).map((x) => ({ key: x.key, opens: Number(x.opens), devices: Number(x.devices) })))(),
  ]);
  const hours = (await db.prepare(
    `SELECT EXTRACT(HOUR FROM o.created_at::timestamptz AT TIME ZONE COALESCE(NULLIF(o.timezone, ''), 'UTC'))::int AS h, COUNT(*) AS n
       FROM marketing_opens o WHERE ${inRange} GROUP BY 1 ORDER BY 1`
  ).all(r.from, r.to).catch(() => [])).map((x) => ({ hour: Number(x.h), opens: Number(x.n) }));
  const points = (await db.prepare(
    `SELECT ROUND(latitude::numeric, 1) AS lat, ROUND(longitude::numeric, 1) AS lon, MAX(city) AS city, MAX(country) AS country,
            COUNT(*) AS opens, COUNT(DISTINCT device_key) AS devices
       FROM marketing_opens o WHERE ${inRange} AND latitude IS NOT NULL GROUP BY 1, 2 ORDER BY opens DESC LIMIT 200`
  ).all(r.from, r.to)).map((p) => ({ lat: Number(p.lat), lon: Number(p.lon), city: p.city, country: p.country, opens: Number(p.opens), devices: Number(p.devices) }));

  const opens = Number(totals.opens) || 0;
  const devices = Number(totals.devices) || 0;
  res.json({
    range: r,
    totals: {
      opens, devices, repeat_opens: Number(totals.repeat_opens) || 0,
      leads: Number(leadTotals.leads) || 0, consented_leads: Number(leadTotals.consented) || 0,
      converted_leads: Number(leadTotals.converted) || 0, signups: Number(signups.n) || 0,
      signup_rate: devices ? Math.round((Number(signups.n) / devices) * 1000) / 10 : 0,
      lead_rate: devices ? Math.round((Number(leadTotals.leads) / devices) * 1000) / 10 : 0,
    },
    links,
    breakdowns: { countries, cities, device_types: deviceTypes, os: oses, browsers, in_app: inApps, languages, channels, hours },
    map: points,
  });
}

/** GET /api/marketing/opens?link_id=&limit= — recent opens, newest first, each marked new or same device. */
async function recentOpens(req, res) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  const args = [];
  let where = '1=1';
  if (req.query.link_id === 'none') where = 'o.link_id IS NULL';
  else if (req.query.link_id) { where = 'o.link_id = ?'; args.push(req.query.link_id); }
  const rows = await db.prepare(
    `SELECT o.id, o.link_id, COALESCE(l.label, ?) AS label, o.device_no, o.open_no, o.device_source, o.device_type, o.os, o.os_version,
            o.browser, o.in_app, o.device_model, o.screen, o.timezone, o.language, o.referrer, o.utm_source, o.utm_medium,
            o.utm_campaign, o.country, o.region, o.city, o.created_at
       FROM marketing_opens o LEFT JOIN marketing_links l ON l.id = o.link_id
      WHERE ${where} ORDER BY o.created_at DESC, o.id LIMIT ?`
  ).all(NO_LABEL, ...args, limit);
  res.json({
    opens: rows.map((o) => ({
      ...o,
      status: Number(o.open_no) === 1 ? 'New device' : `Same device · open #${o.open_no}`,
      is_new_device: Number(o.open_no) === 1,
    })),
  });
}

/** GET /api/marketing/leads */
async function listLeads(req, res) {
  const rows = await db.prepare(
    `SELECT ld.*, COALESCE(l.label, ?) AS label, u.full_name AS converted_name,
            (SELECT COUNT(*) FROM marketing_opens o WHERE o.device_key = ld.device_key) AS device_opens
       FROM marketing_leads ld
       LEFT JOIN marketing_links l ON l.id = ld.link_id
       LEFT JOIN users u ON u.id = ld.converted_user_id
      ORDER BY ld.created_at DESC LIMIT 1000`
  ).all(NO_LABEL);
  res.json({
    leads: rows.map(({ unsubscribe_token, device_key, ...ld }) => ({
      ...ld, device_opens: Number(ld.device_opens) || 0, opens_before: Number(ld.opens_before) || 0,
    })),
  });
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formulas, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** GET /api/marketing/leads.csv */
async function leadsCsv(req, res) {
  const rows = await db.prepare(
    `SELECT ld.created_at, ld.full_name, ld.email, ld.phone, ld.interest, ld.country, ld.city, COALESCE(l.label, ?) AS link,
            ld.opens_before, ld.consent_marketing, ld.unsubscribed_at, ld.converted_user_id, ld.message
       FROM marketing_leads ld LEFT JOIN marketing_links l ON l.id = ld.link_id ORDER BY ld.created_at DESC`
  ).all(NO_LABEL);
  const head = ['created_at', 'full_name', 'email', 'phone', 'interest', 'country', 'city', 'link', 'page_opens_before_form', 'marketing_consent', 'unsubscribed_at', 'signed_up', 'message'];
  const lines = [head.join(',')].concat(rows.map((r) => [r.created_at, r.full_name, r.email, r.phone, r.interest, r.country, r.city, r.link,
    r.opens_before, r.consent_marketing ? 'yes' : 'no', r.unsubscribed_at, r.converted_user_id ? 'yes' : 'no', r.message].map(csvCell).join(',')));
  await logAdminAction(req.user.id, 'marketing.leads_exported', { details: { count: rows.length } });
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="lesson-teacher-leads.csv"').send(`${lines.join('\r\n')}\r\n`);
}

/**
 * POST /api/marketing/leads/email  body: { subject, body, lead_ids?: string[] }
 * Sends a follow-up e-mail only to leads who ticked consent and haven't
 * unsubscribed. Every message carries a personal unsubscribe link.
 */
async function emailLeads(req, res) {
  const b = req.body || {};
  const subject = clip(b.subject, 150);
  const body = typeof b.body === 'string' ? b.body.trim().slice(0, 5000) : '';
  if (!subject || !body) return res.status(400).json({ error: 'Subject and message are required' });
  const ids = Array.isArray(b.lead_ids) ? b.lead_ids.filter((x) => typeof x === 'string').slice(0, 5000) : null;

  let leads = await db.prepare('SELECT * FROM marketing_leads WHERE email IS NOT NULL ORDER BY created_at').all();
  if (ids) { const set = new Set(ids); leads = leads.filter((l) => set.has(l.id)); }
  const eligible = leads.filter((l) => l.consent_marketing && !l.unsubscribed_at);
  const skipped = leads.length - eligible.length;

  const provider = getEmailProvider();
  let sent = 0;
  const ts = now();
  for (const lead of eligible) {
    const first = (lead.full_name || '').split(' ')[0] || 'there';
    const personal = body.replace(/\{name\}/g, first);
    const signupUrl = `${portalUrl()}/#/signup`;
    const unsubscribeUrl = `${portalUrl()}/#/unsubscribe/${lead.unsubscribe_token}`;
    try {
      await provider.send({
        to: lead.email,
        subject,
        body: `${personal}\n\nCreate your free account: ${signupUrl}\n\n—\nYou asked Lesson Teacher to keep you updated. Unsubscribe: ${unsubscribeUrl}`,
      });
      await db.prepare('UPDATE marketing_leads SET last_emailed_at = ? WHERE id = ?').run(ts, lead.id);
      sent += 1;
    } catch (err) {
      console.error('[marketing] follow-up e-mail failed', lead.id, err.message);
    }
  }
  await db.prepare('INSERT INTO marketing_emails (id, subject, body, sent_count, skipped, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), subject, body, sent, skipped, req.user.id, ts);
  await logAdminAction(req.user.id, 'marketing.leads_emailed', { details: { sent, skipped, subject } });
  res.json({ sent, skipped, failed: eligible.length - sent });
}

/** GET /api/marketing/settings, PUT /api/marketing/settings  body: { meta_pixel_id?, google_tag_id?, tiktok_pixel_id? } */
async function getSettings(req, res) {
  const out = {};
  for (const k of Object.keys(PIXEL_KEYS)) out[k] = (await getSetting(k)) || '';
  res.json({ settings: out });
}
async function putSettings(req, res) {
  const b = req.body || {};
  for (const [k, re] of Object.entries(PIXEL_KEYS)) {
    if (b[k] === undefined) continue;
    const v = String(b[k] || '').trim();
    if (v && !re.test(v)) return res.status(400).json({ error: `${k.replace(/_/g, ' ')} doesn't look right` });
  }
  for (const k of Object.keys(PIXEL_KEYS)) if (b[k] !== undefined) await setSetting(k, String(b[k] || '').trim());
  await logAdminAction(req.user.id, 'marketing.settings_updated', { details: b });
  return getSettings(req, res);
}

module.exports = {
  CHANNELS, LANGUAGES, publicConfig, open, createLead, unsubscribe, recordSignupAttribution,
  createLink, updateLink, overview, recentOpens, listLeads, leadsCsv, emailLeads, getSettings, putSettings,
};
