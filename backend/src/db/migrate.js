/**
 * Schema + migrations runner.
 *
 *  1. schema.postgres.sql is the idempotent baseline (CREATE ... IF NOT
 *     EXISTS). It is never edited destructively.
 *  2. Anything that isn't a plain addition — renames, drops, type changes,
 *     data backfills — goes in src/db/migrations/NNN_name.sql instead. Each
 *     file runs once, in filename order, inside a transaction, and is
 *     recorded in schema_migrations.
 *
 * A Postgres advisory lock serialises the whole thing, so several replicas
 * booting at once (see k8s/04-backend.yaml) can't race each other.
 */
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const BASELINE_PATH = path.join(__dirname, 'schema.postgres.sql');
const LOCK_KEY = 727001; // arbitrary app-wide constant

function listMigrations(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
}

/** Applies the baseline schema, then any pending migrations. Returns the list of versions applied. */
async function applyAll(pool, { migrationsDir = MIGRATIONS_DIR, baselinePath = BASELINE_PATH } = {}) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

    await client.query(fs.readFileSync(baselinePath, 'utf8'));
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)'
    );

    const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    for (const file of listMigrations(migrationsDir)) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [file, new Date().toISOString()]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        err.message = `Migration ${file} failed: ${err.message}`;
        throw err;
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

module.exports = { applyAll, listMigrations, MIGRATIONS_DIR };

// CLI: `npm run migrate` (applies baseline + pending migrations) and
// `npm run migrate:new -- add_foo` (scaffolds the next numbered file).
if (require.main === module) {
  require('dotenv').config();
  const [cmd, name] = process.argv.slice(2);
  if (cmd === 'new') {
    if (!name || !/^[a-z0-9_]+$/.test(name)) { console.error('Usage: npm run migrate:new -- snake_case_name'); process.exit(1); }
    const last = listMigrations(MIGRATIONS_DIR).pop();
    const next = String(last ? parseInt(last, 10) + 1 : 1).padStart(3, '0');
    const file = path.join(MIGRATIONS_DIR, `${next}_${name}.sql`);
    fs.writeFileSync(file, `-- ${next}_${name}\n-- Runs once, inside a transaction. Make it safe for existing data.\n\n`);
    console.log(`Created ${file}`);
    process.exit(0);
  }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  applyAll(pool)
    .then((a) => { console.log(a.length ? `Applied: ${a.join(', ')}` : 'Up to date.'); return pool.end(); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
