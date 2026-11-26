// @ts-check
/**
 * Marketing tracking helpers: device identification, user-agent parsing,
 * offline IP geolocation, and the per-link device numbering behind
 * "same device or shared?".
 */
const crypto = require('crypto');
const net = require('net');
const db = require('../config/db');

let geoip = null;
try { geoip = require('fast-geoip'); } catch { geoip = null; }

/** A browser-generated device ID: 16-64 URL-safe characters. */
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

function clip(v, max = 200) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Picks the device key for an open. The pitch page sends a random ID it keeps
 * in the browser; that is the reliable signal. Without it, fall back to a
 * rough signature (model, screen, time zone, language), which cannot tell two
 * identical phones apart.
 */
function resolveDevice({ device_id, model, screen, timezone, language, userAgent }) {
  if (typeof device_id === 'string' && DEVICE_ID_RE.test(device_id)) {
    return { key: `id:${device_id}`, source: 'id' };
  }
  const ua = parseUserAgent(userAgent);
  const parts = [model || ua.device_model || '', ua.os || '', screen || '', timezone || '', language || ''];
  const hash = crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
  return { key: `fp:${hash}`, source: 'fingerprint' };
}

/** Small, dependency-free user-agent reader: device type, OS, browser, in-app browser, model. */
function parseUserAgent(ua = '') {
  const s = String(ua || '');
  const out = { device_type: 'desktop', os: null, os_version: null, browser: null, in_app: null, device_model: null };

  let m;
  if ((m = /Android (\d+(?:\.\d+)?)/.exec(s))) {
    out.os = 'Android'; out.os_version = m[1];
    out.device_type = /Mobile/.test(s) ? 'mobile' : 'tablet';
    const model = /Android [\d.]+; ([^;)]+)/.exec(s);
    const name = model ? model[1].replace(/\s*Build\/.*$/, '').trim() : '';
    if (name && !/^(K|wv|Linux|U)$/.test(name)) out.device_model = name;
  } else if ((m = /(iPhone|iPad|iPod).*? OS (\d+[_\d]*)/.exec(s))) {
    out.os = 'iOS'; out.os_version = m[2].replace(/_/g, '.');
    out.device_type = m[1] === 'iPad' ? 'tablet' : 'mobile';
    out.device_model = m[1];
  } else if ((m = /Windows NT ([\d.]+)/.exec(s))) {
    out.os = 'Windows'; out.os_version = m[1];
  } else if ((m = /Mac OS X ([\d_]+)/.exec(s))) {
    out.os = 'macOS'; out.os_version = m[1].replace(/_/g, '.');
  } else if (/CrOS/.test(s)) {
    out.os = 'ChromeOS';
  } else if (/Linux/.test(s)) {
    out.os = 'Linux';
  }

  if (/FBAN|FBAV|FB_IAB/.test(s)) out.in_app = 'Facebook';
  else if (/Instagram/.test(s)) out.in_app = 'Instagram';
  else if (/BytedanceWebview|musical_ly|TikTok/i.test(s)) out.in_app = 'TikTok';
  else if (/WhatsApp/i.test(s)) out.in_app = 'WhatsApp';
  else if (/Snapchat/i.test(s)) out.in_app = 'Snapchat';
  else if (/LinkedInApp/i.test(s)) out.in_app = 'LinkedIn';
  else if (/Twitter|TwitterAndroid/i.test(s)) out.in_app = 'X (Twitter)';
  else if (/Telegram/i.test(s)) out.in_app = 'Telegram';

  if (/SamsungBrowser/.test(s)) out.browser = 'Samsung Internet';
  else if (/EdgA?\//.test(s)) out.browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) out.browser = 'Opera';
  else if (/Firefox\/|FxiOS/.test(s)) out.browser = 'Firefox';
  else if (/CriOS|Chrome\//.test(s)) out.browser = 'Chrome';
  else if (/Safari\//.test(s)) out.browser = 'Safari';
  if (out.in_app && !out.browser) out.browser = `${out.in_app} in-app`;
  return out;
}

function isPublicIp(ip) {
  if (!ip || !net.isIP(ip)) return false;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    return true;
  }
  const v6 = ip.toLowerCase();
  return !(v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80'));
}

/** City-level location from an offline database. Never leaves the server. */
async function locate(ip) {
  const clean = String(ip || '').replace(/^::ffff:/, '');
  if (!geoip || !isPublicIp(clean)) return {};
  try {
    const g = await geoip.lookup(clean);
    if (!g) return {};
    return {
      country: g.country || null,
      region: g.region || null,
      city: g.city || null,
      latitude: Array.isArray(g.ll) ? g.ll[0] : null,
      longitude: Array.isArray(g.ll) ? g.ll[1] : null,
    };
  } catch {
    return {};
  }
}

/** Salted one-way hash of the IP: lets us notice repeat networks without storing the address. */
function hashIp(ip) {
  if (!ip) return null;
  const salt = process.env.JWT_ACCESS_SECRET || 'lesson-teacher';
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 24);
}

/**
 * Inserts one open, numbering devices per link (#1, #2…) and opens per
 * device (open #1, #2…). A per-link advisory lock keeps the numbering exact
 * when two people open the same link at the same moment.
 */
async function recordOpen(row) {
  const scope = row.link_id || 'no-link';
  return db.transaction(async () => {
    await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?::text))').get(`mkt:${scope}`);
    const linkClause = row.link_id ? 'link_id = ?' : 'link_id IS NULL';
    const linkArgs = row.link_id ? [row.link_id] : [];
    const seen = await db.prepare(
      `SELECT device_no, MAX(open_no) AS opens FROM marketing_opens WHERE ${linkClause} AND device_key = ? GROUP BY device_no`
    ).get(...linkArgs, row.device_key);
    let deviceNo;
    let openNo;
    if (seen) {
      deviceNo = Number(seen.device_no);
      openNo = Number(seen.opens) + 1;
    } else {
      const max = await db.prepare(`SELECT COALESCE(MAX(device_no), 0) AS n FROM marketing_opens WHERE ${linkClause}`).get(...linkArgs);
      deviceNo = Number(max.n) + 1;
      openNo = 1;
    }
    const cols = ['id', 'link_id', 'device_key', 'device_source', 'device_no', 'open_no', 'device_type', 'os', 'os_version', 'browser',
      'in_app', 'device_model', 'screen', 'timezone', 'language', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign',
      'utm_content', 'utm_term', 'ip_hash', 'country', 'region', 'city', 'latitude', 'longitude', 'created_at'];
    const values = { ...row, device_no: deviceNo, open_no: openNo };
    await db.prepare(`INSERT INTO marketing_opens (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map((c) => (values[c] === undefined ? null : values[c])));
    return { device_no: deviceNo, open_no: openNo, is_new_device: openNo === 1 };
  })();
}

/** "1 device, opened 3×" / "Shared · 2 devices" / "No opens yet". */
function verdict(opens, devices) {
  if (!opens) return 'No opens yet';
  if (devices <= 1) return `1 device, opened ${opens}×`;
  return `Shared · ${devices} devices`;
}

module.exports = { DEVICE_ID_RE, clip, resolveDevice, parseUserAgent, isPublicIp, locate, hashIp, recordOpen, verdict };
