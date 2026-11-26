const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');

function now() {
  return new Date().toISOString();
}

/** GET /api/skills?category= */
async function list(req, res) {
  const { category } = req.query;
  const rows = category
    ? await db.prepare('SELECT * FROM skills WHERE category = ? AND deleted_at IS NULL ORDER BY name').all(category)
    : await db.prepare('SELECT * FROM skills WHERE deleted_at IS NULL ORDER BY category, name').all();
  res.json({ skills: rows });
}

/** POST /api/skills  (super_admin) */
async function create(req, res) {
  const { name, category, description, icon } = req.body || {};
  if (!name || !category) return res.status(400).json({ error: 'name and category are required' });

  const id = uuidv4();
  const ts = now();
  await db.prepare('INSERT INTO skills (id, name, category, description, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, category, description || null, icon || null, ts, ts);

  res.status(201).json({ skill: await db.prepare('SELECT * FROM skills WHERE id = ?').get(id) });
}

/** DELETE /api/skills/:id  (super_admin) */
async function remove(req, res) {
  const { id } = req.params;
  const result = await db.prepare('UPDATE skills SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
  if (result.changes === 0) return res.status(404).json({ error: 'Skill not found' });
  res.json({ ok: true });
}

/** GET /api/skills/mine  (tutor) */
async function mine(req, res) {
  const rows = await db
    .prepare(
      `SELECT ts.*, s.name, s.category, s.icon FROM tutor_skills ts
       JOIN skills s ON s.id = ts.skill_id
       WHERE ts.tutor_id = ? AND ts.deleted_at IS NULL ORDER BY s.category, s.name`
    )
    .all(req.user.id);
  res.json({ tutor_skills: rows.map(withEvidenceList) });
}

const PROFICIENCIES = ['beginner', 'intermediate', 'advanced', 'expert'];
const MAX_EVIDENCE = 5;

/** Parses the stored JSON evidence list (falls back to the single legacy link). */
function withEvidenceList(row) {
  let list = [];
  try { list = row.evidence_urls ? JSON.parse(row.evidence_urls) : []; } catch { list = []; }
  if (!list.length && row.evidence_url) list = [row.evidence_url];
  return { ...row, evidence_urls: list };
}

/**
 * POST /api/skills/mine  (tutor)
 * body: { skill_id, proficiency, evidence_urls?: string[] (up to 5 https links), evidence_url? (legacy single link) }
 */
async function addMine(req, res) {
  const { skill_id } = req.body || {};
  const proficiency = req.body?.proficiency || 'intermediate';
  if (!PROFICIENCIES.includes(proficiency)) {
    return res.status(400).json({ error: `proficiency must be one of: ${PROFICIENCIES.join(', ')}` });
  }
  let links = Array.isArray(req.body?.evidence_urls) ? req.body.evidence_urls : (req.body?.evidence_url ? [req.body.evidence_url] : []);
  links = links.map((l) => String(l || '').trim()).filter(Boolean);
  if (links.length > MAX_EVIDENCE) return res.status(400).json({ error: `Add at most ${MAX_EVIDENCE} evidence links` });
  if (links.some((l) => !/^https?:\/\/\S+$/i.test(l) || l.length > 500)) {
    return res.status(400).json({ error: 'Evidence links must be web addresses starting with https://' });
  }
  const evidence_url = links[0] || null;
  const evidenceJson = links.length ? JSON.stringify(links) : null;
  const skill = await db.prepare('SELECT id FROM skills WHERE id = ? AND deleted_at IS NULL').get(skill_id);
  if (!skill) return res.status(400).json({ error: 'skill_id does not match a known skill' });

  const existing = await db.prepare('SELECT id FROM tutor_skills WHERE tutor_id = ? AND skill_id = ?').get(req.user.id, skill_id);
  const ts = now();

  if (existing) {
    await db.prepare('UPDATE tutor_skills SET proficiency = ?, evidence_url = ?, evidence_urls = ?, deleted_at = NULL, updated_at = ? WHERE id = ?')
      .run(proficiency, evidence_url, evidenceJson, ts, existing.id);
  } else {
    await db.prepare(
      'INSERT INTO tutor_skills (id, tutor_id, skill_id, proficiency, evidence_url, evidence_urls, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), req.user.id, skill_id, proficiency, evidence_url, evidenceJson, ts, ts);
  }

  res.status(201).json({ ok: true });
}

/** DELETE /api/skills/mine/:skillId  (tutor) */
async function removeMine(req, res) {
  const { skillId } = req.params;
  const result = await db
    .prepare('UPDATE tutor_skills SET deleted_at = ?, updated_at = ? WHERE tutor_id = ? AND skill_id = ?')
    .run(now(), now(), req.user.id, skillId);
  if (result.changes === 0) return res.status(404).json({ error: 'Not attached to this skill' });
  res.json({ ok: true });
}

module.exports = { list, create, remove, mine, addMine, removeMine };
