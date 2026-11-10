const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');
const { SYNC_TABLES, READ_ONLY_ROLES } = require('../db/syncTables');

function now() {
  return new Date().toISOString();
}

/** GET /api/sync/pull?since=...&tables=... */
async function pull(req, res) {
  const since = req.query.since || '1970-01-01T00:00:00.000Z';
  const requestedTables = req.query.tables
    ? req.query.tables.split(',').map((t) => t.trim())
    : Object.keys(SYNC_TABLES);

  const serverTime = now();
  const result = {};

  for (const table of requestedTables) {
    const config = SYNC_TABLES[table];
    if (!config) continue;

    const { clause, params } = config.pullWhere(req.user);
    const sql = `SELECT * FROM ${table} WHERE (${clause}) AND updated_at > @since ORDER BY updated_at ASC`;
    try {
      const rows = await db.prepare(sql).all({ ...params, since });
      result[table] = table === 'users' ? rows.map(({ password_hash, ...safe }) => safe) : rows;
    } catch (err) {
      result[table] = { error: `Failed to sync ${table}: ${err.message}` };
    }
  }

  res.json({ server_time: serverTime, since, tables: result });
}

/** POST /api/sync/push */
async function push(req, res) {
  if (READ_ONLY_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: `${req.user.role} accounts do not push data changes` });
  }

  const { changes } = req.body || {};
  if (!Array.isArray(changes)) {
    return res.status(400).json({ error: 'changes must be an array' });
  }

  const applied = [];
  const rejected = [];
  const conflicts = [];

  const txn = db.transaction(async () => {
    for (const change of changes) {
      const { table, operation, record } = change || {};
      const config = SYNC_TABLES[table];

      if (!config || !['create', 'update', 'delete'].includes(operation) || !record || !record.id) {
        rejected.push({ change, reason: 'malformed change' });
        continue;
      }
      if (!config.canWrite(req.user, record)) {
        rejected.push({ change, reason: 'not permitted for this user' });
        continue;
      }

      const existing = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(record.id);

      if (existing && record.base_updated_at && existing.updated_at > record.base_updated_at) {
        conflicts.push({ table, id: record.id, server_record: existing });
        continue;
      }

      const ts = now();

      if (operation === 'delete') {
        if (existing) {
          await db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, record.id);
        }
        applied.push({ table, id: record.id, operation });
        continue;
      }

      const fields = config.writableFields.filter((f) => f in record);
      if (operation === 'create' && !existing) {
        const columns = ['id', ...fields, 'created_at', 'updated_at'];
        const placeholders = columns.map(() => '?').join(', ');
        const values = [record.id, ...fields.map((f) => record[f] ?? null), ts, ts];
        await db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
      } else if (existing) {
        const setClause = fields.map((f) => `${f} = ?`).join(', ');
        if (setClause) {
          const values = [...fields.map((f) => record[f] ?? null), ts, record.id];
          await db.prepare(`UPDATE ${table} SET ${setClause}, updated_at = ? WHERE id = ?`).run(...values);
        }
      } else {
        const columns = ['id', ...fields, 'created_at', 'updated_at'];
        const placeholders = columns.map(() => '?').join(', ');
        const values = [record.id, ...fields.map((f) => record[f] ?? null), ts, ts];
        await db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
      }

      applied.push({
        table,
        id: record.id,
        operation,
        server_record: await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(record.id),
      });
    }
  });

  await txn();

  res.json({ server_time: now(), applied, rejected, conflicts });
}

module.exports = { pull, push };
