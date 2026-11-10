const db = require('../config/db');

/**
 * Resolves a children.id the requester is allowed to see progress for:
 * the parent who owns that child, the child themself, or a super_admin.
 * Returns the child row, or null if not found/not permitted.
 */
async function resolveViewableChild(req, childId) {
  const child = await db.prepare('SELECT * FROM children WHERE id = ? AND deleted_at IS NULL').get(childId);
  if (!child) return null;

  const isOwnParent = req.user.role === 'parent' && child.parent_id === req.user.id;
  const isSelf = req.user.role === 'child' && child.user_id === req.user.id;
  const isAdmin = req.user.role === 'super_admin';
  if (!isOwnParent && !isSelf && !isAdmin) return null;
  return child;
}

/** GET /api/gamification/badges — public catalog */
async function listBadgeCatalog(req, res) {
  const rows = await db.prepare('SELECT * FROM badges WHERE deleted_at IS NULL ORDER BY category, name').all();
  res.json({ badges: rows });
}

/** GET /api/gamification/children/:childId/badges */
async function childBadges(req, res) {
  const child = await resolveViewableChild(req, req.params.childId);
  if (!child) return res.status(404).json({ error: 'Child not found or not visible to you' });
  if (!child.user_id) return res.json({ badges: [] }); // no login yet granted -> nothing earned under a user_id

  const rows = await db
    .prepare(
      `SELECT b.code, b.name, b.description, b.icon, b.category, ub.awarded_at
       FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
       WHERE ub.user_id = ? ORDER BY ub.awarded_at DESC`
    )
    .all(child.user_id);
  res.json({ badges: rows });
}

/** GET /api/gamification/children/:childId/streak */
async function childStreak(req, res) {
  const child = await resolveViewableChild(req, req.params.childId);
  if (!child) return res.status(404).json({ error: 'Child not found or not visible to you' });

  const streak = await db.prepare('SELECT * FROM child_streaks WHERE child_id = ?').get(child.id);
  res.json({
    streak: streak || { child_id: child.id, current_streak: 0, longest_streak: 0, total_points: 0, last_activity_on: null },
  });
}

/**
 * GET /api/gamification/leaderboard/siblings  (parent)
 * Ranks the parent's own children against each other only — never
 * another family's children — so this is always safe to show in full.
 */
async function siblingLeaderboard(req, res) {
  if (req.user.role !== 'parent') return res.status(403).json({ error: 'Only parents can view a sibling leaderboard' });

  const rows = await db
    .prepare(
      `SELECT c.id AS child_id, c.full_name, COALESCE(cs.total_points, 0) AS total_points,
              COALESCE(cs.current_streak, 0) AS current_streak
       FROM children c LEFT JOIN child_streaks cs ON cs.child_id = c.id
       WHERE c.parent_id = ? AND c.deleted_at IS NULL
       ORDER BY total_points DESC`
    )
    .all(req.user.id);
  res.json({ leaderboard: rows });
}

/**
 * GET /api/gamification/leaderboard/school  (any role within that school)
 * Shows only first name + last initial — never a child's full identity —
 * and only children already attached to this school, never cross-school.
 */
async function schoolLeaderboard(req, res) {
  const schoolId = req.user.school_id || req.query.school_id;
  if (!schoolId) return res.status(400).json({ error: 'No school context for this request' });

  const rows = await db
    .prepare(
      `SELECT c.id AS child_id, c.full_name, COALESCE(cs.total_points, 0) AS total_points,
              COALESCE(cs.current_streak, 0) AS current_streak
       FROM children c LEFT JOIN child_streaks cs ON cs.child_id = c.id
       WHERE c.school_id = ? AND c.deleted_at IS NULL
       ORDER BY total_points DESC LIMIT 50`
    )
    .all(schoolId);

  const anonymized = rows.map((r) => ({
    ...r,
    full_name: undefined,
    display_name: toFirstNameLastInitial(r.full_name),
  }));
  res.json({ leaderboard: anonymized });
}

function toFirstNameLastInitial(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

module.exports = { listBadgeCatalog, childBadges, childStreak, siblingLeaderboard, schoolLeaderboard };
