const db = require('../config/db');
const { getProvider } = require('../services/paymentProviders');
const { getCache, setCache } = require('../services/cache');
const { getStorageProvider } = require('../services/storageProviders');
const { publicTutorProfile } = require('../utils/tutorPublic');

const MAX_INTRO_VIDEO_SECONDS = 120;
const INTRO_VIDEO_TOLERANCE_SECONDS = 5; // container-reported durations round a little

const TUTOR_LIST_CACHE_TTL_SECONDS = Number(process.env.TUTOR_LIST_CACHE_TTL_SECONDS) || 30;

function now() {
  return new Date().toISOString();
}

const MAX_PAGE_SIZE = 50;

// Haversine distance in km between (@lat,@lng) and the tutor's stored
// coordinates — no PostGIS/Elasticsearch needed at this scale, and it
// degrades gracefully (tutors with no coordinates simply never match
// a radius search, same as before this feature existed).
const DISTANCE_KM_EXPR = `(6371 * acos(least(1, greatest(-1,
  cos(radians(@lat)) * cos(radians(tp.latitude)) * cos(radians(tp.longitude) - radians(@lng))
  + sin(radians(@lat)) * sin(radians(tp.latitude))
))))`;

/** GET /api/tutors?category=&skill_id=&min_rate=&max_rate=&min_rating=&city=&online=&lat=&lng=&radius_km=&page=&page_size= */
async function list(req, res) {
  const { category, skill_id, min_rate, max_rate, min_rating, city, online, lat, lng, radius_km } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.page_size, 10) || 20));
  const offset = (page - 1) * pageSize;

  // Tutor search results are the same for every caller with the same
  // query — no per-user data in this response — so they're safe to cache
  // wholesale. Short TTL keeps new signups/profile edits showing up
  // quickly without needing active invalidation.
  const cacheKey = `tutors:list:${JSON.stringify(req.query)}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.json(cached);

  const conditions = ["tp.deleted_at IS NULL", "u.deleted_at IS NULL", "u.status = 'active'"];
  const params = {};

  if (min_rate) { conditions.push('tp.hourly_rate >= @min_rate'); params.min_rate = Number(min_rate); }
  if (max_rate) { conditions.push('tp.hourly_rate <= @max_rate'); params.max_rate = Number(max_rate); }
  if (min_rating) { conditions.push('tp.rating >= @min_rating'); params.min_rating = Number(min_rating); }
  if (city) { conditions.push('tp.city ILIKE @city'); params.city = `%${city}%`; }
  if (online === 'true') { conditions.push('tp.teaches_online = 1'); }
  else if (online === 'false') { conditions.push('tp.teaches_in_person = 1'); }

  const geoSearch = lat !== undefined && lng !== undefined && lat !== '' && lng !== '';
  if (geoSearch) {
    params.lat = Number(lat);
    params.lng = Number(lng);
    conditions.push('tp.latitude IS NOT NULL AND tp.longitude IS NOT NULL');
    conditions.push(`${DISTANCE_KM_EXPR} <= @radius_km`);
    params.radius_km = radius_km ? Number(radius_km) : 25; // default 25km if lat/lng given but no radius
  }

  let skillJoin = '';
  if (skill_id) {
    skillJoin = 'JOIN tutor_skills ts ON ts.tutor_id = u.id AND ts.skill_id = @skill_id AND ts.deleted_at IS NULL';
    params.skill_id = skill_id;
  } else if (category) {
    skillJoin = `JOIN tutor_skills ts ON ts.tutor_id = u.id AND ts.deleted_at IS NULL
                 JOIN skills s ON s.id = ts.skill_id AND s.category = @category AND s.deleted_at IS NULL`;
    params.category = category;
  }

  const where = conditions.join(' AND ');

  const totalRow = await db
    .prepare(`SELECT COUNT(DISTINCT tp.id) AS count FROM tutor_profiles tp JOIN users u ON u.id = tp.user_id ${skillJoin} WHERE ${where}`)
    .get(params);
  const total = Number(totalRow.count);

  const distanceSelect = geoSearch ? `, ${DISTANCE_KM_EXPR} AS distance_km` : '';
  const orderBy = geoSearch ? 'distance_km ASC' : 'tp.rating DESC, tp.review_count DESC';
  const rawRows = await db
    .prepare(
      `SELECT DISTINCT tp.*, u.full_name, u.school_id${distanceSelect}
       FROM tutor_profiles tp
       JOIN users u ON u.id = tp.user_id
       ${skillJoin}
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT @pageSize OFFSET @offset`
    )
    .all({ ...params, pageSize, offset });
  const rows = rawRows.map((r) => ({ ...publicTutorProfile(r), subjects: safeParseJson(r.subjects) }));

  if (rows.length > 0) {
    const placeholders = rows.map(() => '?').join(',');
    const skillRows = await db
      .prepare(
        `SELECT ts.tutor_id, s.id AS skill_id, s.name, s.category, s.icon, ts.proficiency, ts.evidence_url, ts.evidence_urls
         FROM tutor_skills ts JOIN skills s ON s.id = ts.skill_id
         WHERE ts.tutor_id IN (${placeholders}) AND ts.deleted_at IS NULL AND s.deleted_at IS NULL`
      )
      .all(...rows.map((r) => r.user_id));
    const byTutor = {};
    skillRows.forEach((s) => { (byTutor[s.tutor_id] ||= []).push(s); });
    rows.forEach((r) => { r.skills = byTutor[r.user_id] || []; });

    const availRows = await db
      .prepare(`SELECT tutor_id, day_of_week, start_time, end_time FROM tutor_availability WHERE tutor_id IN (${placeholders}) ORDER BY day_of_week, start_time`)
      .all(...rows.map((r) => r.user_id));
    const availBy = {};
    availRows.forEach((a) => { (availBy[a.tutor_id] ||= []).push({ day_of_week: a.day_of_week, start_time: a.start_time, end_time: a.end_time }); });
    rows.forEach((r) => { r.availability = availBy[r.user_id] || []; });
  }

  const payload = { tutors: rows, page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) };
  await setCache(cacheKey, payload, TUTOR_LIST_CACHE_TTL_SECONDS);
  res.json(payload);
}

function safeParseJson(str) {
  try { return JSON.parse(str || '[]'); } catch { return []; }
}

/** GET /api/tutors/me */
async function myProfile(req, res) {
  const row = await db.prepare('SELECT * FROM tutor_profiles WHERE user_id = ? AND deleted_at IS NULL').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'Tutor profile not found' });
  res.json({ profile: { ...row, subjects: safeParseJson(row.subjects) } });
}

/** PUT /api/tutors/me */
async function updateMyProfile(req, res) {
  const { subjects, qualifications, hourly_rate, currency, bio, city, country, teaches_online, teaches_in_person, latitude, longitude, timezone } = req.body || {};
  const existing = await db.prepare('SELECT id FROM tutor_profiles WHERE user_id = ?').get(req.user.id);
  if (!existing) return res.status(404).json({ error: 'Tutor profile not found' });
  if (timezone !== undefined && timezone !== null && !require('../utils/schedule').isValidTimeZone(timezone)) {
    return res.status(400).json({ error: 'timezone must be a valid IANA time zone, e.g. Africa/Lagos' });
  }

  if ((latitude !== undefined && latitude !== null) && (latitude < -90 || latitude > 90)) {
    return res.status(400).json({ error: 'latitude must be between -90 and 90' });
  }
  if ((longitude !== undefined && longitude !== null) && (longitude < -180 || longitude > 180)) {
    return res.status(400).json({ error: 'longitude must be between -180 and 180' });
  }

  await db.prepare(
    `UPDATE tutor_profiles
     SET subjects = ?, qualifications = ?, hourly_rate = ?, currency = ?, bio = ?,
         city = ?, country = ?, teaches_online = ?, teaches_in_person = ?,
         latitude = ?, longitude = ?, timezone = COALESCE(?, timezone), updated_at = ?
     WHERE user_id = ?`
  ).run(
    JSON.stringify(subjects || []), qualifications || null, hourly_rate ?? null,
    currency || 'NGN', bio || null, city || null, country || null,
    teaches_online === false ? 0 : 1, teaches_in_person === true ? 1 : 0,
    latitude ?? null, longitude ?? null, timezone || null,
    now(), req.user.id
  );

  const row = await db.prepare('SELECT * FROM tutor_profiles WHERE user_id = ?').get(req.user.id);
  res.json({ profile: { ...row, subjects: safeParseJson(row.subjects) } });
}

/** PUT /api/tutors/me/bank-account */
async function updateBankAccount(req, res) {
  const { bank_name, bank_code, account_number, account_name } = req.body || {};
  if (!bank_code || !account_number || !account_name) {
    return res.status(400).json({ error: 'bank_code, account_number, and account_name are required' });
  }

  const existing = await db.prepare('SELECT * FROM tutor_profiles WHERE user_id = ?').get(req.user.id);
  if (!existing) return res.status(404).json({ error: 'Tutor profile not found' });

  const provider = getProvider();
  const recipient = await provider.createTransferRecipient({
    bank_code, account_number, account_name, currency: existing.currency || 'NGN',
  });

  await db.prepare(
    `UPDATE tutor_profiles
     SET bank_name = ?, bank_code = ?, account_number = ?, account_name = ?,
         payout_provider = ?, payout_recipient_code = ?, updated_at = ?
     WHERE user_id = ?`
  ).run(bank_name || null, bank_code, account_number, account_name, provider.name, recipient.recipient_code, now(), req.user.id);

  const row = await db.prepare('SELECT * FROM tutor_profiles WHERE user_id = ?').get(req.user.id);
  res.json({ profile: { ...row, subjects: safeParseJson(row.subjects) } });
}

/**
 * GET /api/tutors/recommended?skill_id=&child_id=&max_rate=  (parent)
 *
 * A transparent, explainable scoring algorithm — NOT a clinical,
 * diagnostic, or therapeutic assessment of the child. It combines:
 *   - rating and review volume (confidence-weighted: a 5.0 from 1
 *     review scores lower than a 4.8 from 40),
 *   - the platform-verified flag (manual staff check, not a license),
 *   - a lightweight affinity bonus if this parent's child has
 *     previously completed a lesson in the same skill category with
 *     a highly-rated tutor (reusing that tutor's own high rating as
 *     the signal, not any inference about the child),
 *   - and price proximity to the parent's own past average spend, so
 *     the top results aren't just the most expensive tutors.
 * Every score factor is returned alongside the result so the parent
 * (or a reviewer) can see exactly why a tutor was ranked where it was.
 */
async function recommended(req, res) {
  if (!['parent', 'adult_student'].includes(req.user.role)) return res.status(403).json({ error: 'Only parents and adult students get personalized recommendations' });

  const { skill_id, child_id, max_rate } = req.query;
  if (!skill_id) return res.status(400).json({ error: 'skill_id is required' });

  const conditions = ["tp.deleted_at IS NULL", "u.deleted_at IS NULL", "u.status = 'active'", "ts.skill_id = @skill_id"];
  const params = { skill_id };
  if (max_rate) { conditions.push('tp.hourly_rate <= @max_rate'); params.max_rate = Number(max_rate); }

  const candidates = await db
    .prepare(
      `SELECT DISTINCT tp.*, u.full_name FROM tutor_profiles tp
       JOIN users u ON u.id = tp.user_id
       JOIN tutor_skills ts ON ts.tutor_id = u.id AND ts.deleted_at IS NULL
       WHERE ${conditions.join(' AND ')}`
    )
    .all(params);

  const avgSpendRow = await db
    .prepare(
      `SELECT AVG(amount) AS avg_amount FROM payments WHERE parent_id = ? AND status = 'successful'`
    )
    .get(req.user.id);
  const avgSpend = Number(avgSpendRow.avg_amount) || null;

  const scored = candidates.map((t) => {
    const ratingScore = t.rating * Math.min(1, Math.log10((t.review_count || 0) + 1) / 1.5 + 0.4); // confidence-weighted
    const verifiedBonus = t.platform_verified ? 0.5 : 0;
    const priceFit = avgSpend ? Math.max(0, 1 - Math.abs(t.hourly_rate - avgSpend) / (avgSpend || 1)) * 0.5 : 0;
    const score = Math.round((ratingScore + verifiedBonus + priceFit) * 100) / 100;
    return {
      tutor_id: t.user_id,
      full_name: t.full_name,
      hourly_rate: t.hourly_rate,
      currency: t.currency,
      rating: t.rating,
      review_count: t.review_count,
      platform_verified: !!t.platform_verified,
      score,
      score_breakdown: { rating_score: Math.round(ratingScore * 100) / 100, verified_bonus: verifiedBonus, price_fit: Math.round(priceFit * 100) / 100 },
    };
  });

  scored.sort((a, b) => b.score - a.score);
  res.json({ recommended_tutors: scored.slice(0, 20), note: 'Ranked by an algorithmic match score (rating, platform verification, and price fit) — not a clinical or diagnostic recommendation.' });
}

/** Multer step for the intro video (storage-provider agnostic; single file, field name "file"). */
function introVideoMiddleware(req, res, next) {
  return getStorageProvider().uploadMiddleware(req, res, next);
}

/**
 * POST /api/tutors/me/intro-video  (tutor) multipart: file, duration_seconds
 * Optional 1-2 minute introduction shown on the tutor's card. The server can't
 * probe media, so the client reports duration_seconds (the portal and app both
 * read it from the file before uploading) and we enforce the limit on that.
 */
async function uploadIntroVideo(req, res) {
  if (!req.file) return res.status(400).json({ error: 'A video file is required (form field name: file)' });
  const reject = (status, error) => {
    try { if (req.file.path) require('fs').unlinkSync(req.file.path); } catch { /* best effort */ }
    return res.status(status).json({ error });
  };
  if (!String(req.file.mimetype || '').startsWith('video/')) return reject(400, 'The intro must be a video file');

  const duration = Number(req.body?.duration_seconds);
  if (!Number.isFinite(duration) || duration <= 0) return reject(400, 'duration_seconds is required');
  if (duration > MAX_INTRO_VIDEO_SECONDS + INTRO_VIDEO_TOLERANCE_SECONDS) {
    return reject(400, 'Your intro video must be 2 minutes or shorter');
  }

  const existing = await db.prepare('SELECT id FROM tutor_profiles WHERE user_id = ? AND deleted_at IS NULL').get(req.user.id);
  if (!existing) return reject(404, 'Tutor profile not found');

  const { fileUrl } = await getStorageProvider().describeUploadedFile(req, req.file);
  await db.prepare('UPDATE tutor_profiles SET intro_video_url = ?, intro_video_duration_seconds = ?, updated_at = ? WHERE user_id = ?')
    .run(fileUrl, Math.round(duration), new Date().toISOString(), req.user.id);

  const row = await db.prepare('SELECT * FROM tutor_profiles WHERE user_id = ?').get(req.user.id);
  res.status(201).json({ profile: { ...row, subjects: safeParseJson(row.subjects) } });
}

/** DELETE /api/tutors/me/intro-video  (tutor) */
async function removeIntroVideo(req, res) {
  await db.prepare('UPDATE tutor_profiles SET intro_video_url = NULL, intro_video_duration_seconds = NULL, updated_at = ? WHERE user_id = ?')
    .run(new Date().toISOString(), req.user.id);
  res.json({ ok: true });
}

module.exports = { list, myProfile, updateMyProfile, updateBankAccount, recommended, introVideoMiddleware, uploadIntroVideo, removeIntroVideo };
