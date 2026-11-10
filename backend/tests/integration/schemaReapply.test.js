const fs = require('fs');
const path = require('path');
const db = require('../../src/config/db');

// Every boot re-runs the baseline schema, then migrations. Rows written by the
// running app (e.g. in_app notifications) must never make a re-run fail.
describe('schema re-apply on a populated database', () => {
  it('re-running baseline + migrations succeeds with existing in_app notifications', async () => {
    await db.ready();
    const u = await db.prepare('SELECT id FROM users LIMIT 1').get();
    if (u) {
      await db.prepare("INSERT INTO notifications (id, user_id, channel, type, subject, body, status, created_at) VALUES (?, ?, 'in_app', 't', 's', 'b', 'sent', ?)")
        .run(`reapply-${Date.now()}`, u.id, new Date().toISOString());
    }
    const sql = fs.readFileSync(path.join(__dirname, '../../src/db/schema.postgres.sql'), 'utf8');
    await expect(db.pool.query(sql)).resolves.toBeDefined();
    await expect(require('../../src/db/migrate').applyAll(db.pool)).resolves.not.toThrow();
  });
});
