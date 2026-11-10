const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { applyAll } = require('../../src/db/migrate');

describe('migration runner', () => {
  let pool;
  let dir;
  beforeAll(() => { pool = new Pool({ connectionString: process.env.DATABASE_URL }); });
  afterAll(async () => {
    await pool.query("DELETE FROM schema_migrations WHERE version LIKE '9%_t_%'");
    await pool.query('DROP TABLE IF EXISTS mig_t_a, mig_t_b');
    await pool.end();
  });
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-')); });

  const write = (name, sql) => fs.writeFileSync(path.join(dir, name), sql);

  it('applies pending migrations once, in filename order', async () => {
    write('902_t_b.sql', 'CREATE TABLE mig_t_b (x INT); INSERT INTO mig_t_b VALUES (2);');
    write('901_t_a.sql', 'CREATE TABLE mig_t_a (x INT); INSERT INTO mig_t_a VALUES (1);');
    const first = await applyAll(pool, { migrationsDir: dir });
    expect(first).toEqual(['901_t_a.sql', '902_t_b.sql']);
    expect(await applyAll(pool, { migrationsDir: dir })).toEqual([]);
    expect((await pool.query('SELECT x FROM mig_t_a')).rows).toEqual([{ x: 1 }]);
  });

  it('rolls back a failing migration and does not record it', async () => {
    write('903_t_bad.sql', 'CREATE TABLE mig_t_bad (x INT); SELECT * FROM does_not_exist;');
    await expect(applyAll(pool, { migrationsDir: dir })).rejects.toThrow(/903_t_bad.sql failed/);
    expect((await pool.query("SELECT to_regclass('mig_t_bad') AS t")).rows[0].t).toBeNull();
    expect((await pool.query("SELECT 1 FROM schema_migrations WHERE version = '903_t_bad.sql'")).rowCount).toBe(0);
  });

  it('is safe when two instances start at once', async () => {
    write('904_t_race.sql', 'CREATE TABLE mig_t_race (x INT);');
    const results = await Promise.all([applyAll(pool, { migrationsDir: dir }), applyAll(pool, { migrationsDir: dir })]);
    expect(results.flat()).toEqual(['904_t_race.sql']);
    await pool.query('DROP TABLE mig_t_race');
    await pool.query("DELETE FROM schema_migrations WHERE version = '904_t_race.sql'");
  });
});
