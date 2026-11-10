const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://lessonteacher:lessonteacher_dev_pw@localhost:5432/lessonteacher',
});

const als = new AsyncLocalStorage();

function executor() {
  return als.getStore() || pool;
}

/** Returns [start, end] character ranges (inclusive) covered by single-quoted string literals in `sql`. */
function getQuotedRanges(sql) {
  const ranges = [];
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "'") {
      if (!inQuote) {
        inQuote = true;
        start = i;
      } else {
        inQuote = false;
        ranges.push([start, i]);
      }
    }
  }
  return ranges;
}

function isInsideRanges(idx, ranges) {
  return ranges.some(([s, e]) => idx > s && idx < e);
}

/**
 * Compiles a SQLite-style query (either `?` positional or `@name`
 * named placeholders — both are used across the codebase) into a
 * Postgres query with `$1, $2...` placeholders, plus a function that
 * turns the call-site arguments into the correctly ordered param array.
 * Placeholder-like characters inside string literals (e.g. an `@` in a
 * hardcoded email address) are correctly ignored.
 */
function compile(sql) {
  const quotedRanges = getQuotedRanges(sql);
  const matchesOutsideQuotes = (regex) =>
    [...sql.matchAll(regex)].filter((m) => !isInsideRanges(m.index, quotedRanges));

  const namedMatches = matchesOutsideQuotes(/@([a-zA-Z_][a-zA-Z0-9_]*)/g);

  if (namedMatches.length > 0) {
    const order = [];
    let result = '';
    let lastIndex = 0;
    let i = 0;
    for (const m of namedMatches) {
      result += sql.slice(lastIndex, m.index);
      i += 1;
      order.push(m[1]);
      result += `$${i}`;
      lastIndex = m.index + m[0].length;
    }
    result += sql.slice(lastIndex);
    return {
      pgSql: result,
      toParams: (args) => {
        const obj = args[0] || {};
        return order.map((name) => (obj[name] === undefined ? null : obj[name]));
      },
    };
  }

  const qMatches = matchesOutsideQuotes(/\?/g);
  if (qMatches.length === 0) {
    // No placeholders of either style — Postgres expects exactly zero
    // bind parameters. Callers sometimes still pass an argument (e.g.
    // an empty filter object when no optional filters are active), so
    // this has to be forced rather than just "pass args through".
    return { pgSql: sql, toParams: () => [] };
  }

  let result = '';
  let lastIndex = 0;
  let i = 0;
  for (const m of qMatches) {
    result += sql.slice(lastIndex, m.index);
    i += 1;
    result += `$${i}`;
    lastIndex = m.index + m[0].length;
  }
  result += sql.slice(lastIndex);
  return {
    pgSql: result,
    toParams: (args) => args.map((a) => (a === undefined ? null : a)),
  };
}

function prepare(sql) {
  const { pgSql, toParams } = compile(sql);
  return {
    async get(...args) {
      const res = await executor().query(pgSql, toParams(args));
      return res.rows[0];
    },
    async all(...args) {
      const res = await executor().query(pgSql, toParams(args));
      return res.rows;
    },
    async run(...args) {
      const res = await executor().query(pgSql, toParams(args));
      return { changes: res.rowCount };
    },
  };
}

/**
 * Mirrors better-sqlite3's `db.transaction(fn)` API: returns a function
 * that, when called, runs `fn` inside a BEGIN/COMMIT block. Any
 * `db.prepare(...)` calls made anywhere inside `fn` (even in helper
 * functions it calls) transparently use the same client, via
 * AsyncLocalStorage, without needing to thread a client argument
 * through every function signature.
 */
function transaction(fn) {
  return async (...args) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await als.run(client, () => fn(...args));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };
}

async function exec(sql) {
  await pool.query(sql);
}

async function applySchema() {
  await require('../db/migrate').applyAll(pool);
}

// Under Jest, each test file gets its own isolated module registry, so
// this file (and this side effect) would otherwise run once per test
// file — concurrently, which races on CREATE TABLE. In test mode, the
// schema is applied exactly once up front by tests/globalSetup.js
// instead, and `ready` just resolves immediately.
const ready = process.env.NODE_ENV === 'test'
  ? Promise.resolve()
  : applySchema().catch((err) => {
      console.error('Failed to apply schema:', err);
      process.exit(1);
    });

module.exports = { prepare, transaction, exec, pool, ready: () => ready };
