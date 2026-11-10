# Lesson Teacher — Backend

Node.js + Express API on **PostgreSQL** (no ORM — raw SQL via a thin
`pg` adapter in `src/config/db.js`). Covers auth, referrals, schools,
tutors/skills, bookings, auditions, payments/payouts, mobile
offline-sync, and gated child↔tutor messaging with parent monitoring.

## Setup

1. **Install PostgreSQL** (if you don't already have it):
   ```bash
   # Ubuntu/Debian
   sudo apt-get install postgresql postgresql-contrib
   sudo service postgresql start
   ```

2. **Create the database and user:**
   ```bash
   sudo -u postgres psql -c "CREATE USER lessonteacher WITH PASSWORD 'yourpassword';"
   sudo -u postgres psql -c "CREATE DATABASE lessonteacher OWNER lessonteacher;"
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # edit DATABASE_URL to match the user/password/db you just created
   ```

4. **Install and run:**
   ```bash
   npm install
   npm start
   ```
   The schema (`src/db/schema.postgres.sql`) applies automatically on
   boot — no separate migration step needed. It's idempotent
   (`CREATE TABLE IF NOT EXISTS`), safe to restart repeatedly.

5. **Seed data:**
   ```bash
   npm run seed:admin -- --email admin@lessonteacher.com --password ChangeMe123! --name "Platform Admin"
   npm run seed:skills
   ```
   `super_admin` can't be created through signup on purpose — this is
   the only way to get the first one.

## How the database layer works

`src/config/db.js` exposes `db.prepare(sql).get/all/run()`, matching
the shape of `better-sqlite3`'s API (which this project used before
migrating to Postgres) so the rest of the codebase reads the same way
whether a query returns one row, many rows, or just an affected-row
count. Two placeholder styles are supported and auto-detected:
- `?` positional (most queries)
- `@name` named (used where a query is built up conditionally, e.g.
  the tutor discovery filters and the mobile sync engine)

`db.transaction(fn)` mirrors better-sqlite3's transaction API too —
call it, get back a function, call that function to run `fn` inside a
`BEGIN`/`COMMIT`. Under the hood it uses `AsyncLocalStorage` so any
`db.prepare()` call anywhere inside `fn` (including in helper
functions it calls) transparently uses the same client — no need to
thread a client argument through every function.

## Real-time messaging

`src/realtime/socket.js` sets up Socket.IO with JWT auth on the
handshake. Clients call `join_conversation` with a conversation ID;
the server re-checks access server-side (never trusts the client) before
adding the socket to that conversation's room. New messages sent via
`POST /api/conversations/:id/messages` are broadcast to the room, and
flagged messages additionally broadcast to an `admin_flags` room that
every connected `super_admin` socket joins automatically.

## Payments

Defaults to a **mock provider** (`PAYMENT_PROVIDER=mock`) that
simulates Paystack's checkout flow locally — the whole payment →
payout pipeline is testable without a live gateway. Switch to
`PAYMENT_PROVIDER=paystack` and set `PAYSTACK_SECRET_KEY` to go live;
see `src/services/paymentProviders/paystackProvider.js`.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Run the server |
| `npm run dev` | Run with `--watch` (auto-restart on file changes) |
| `npm run seed:admin` | Create the first super_admin account |
| `npm run seed:skills` | Load the curated skill catalog |

## Messaging

Two distinct kinds of conversation, both gated on a confirmed booking
(no cold-contact spam either direction):
- **`child_tutor`** — a child and their tutor, once the parent has a
  confirmed booking with that tutor for that child. The parent gets
  automatic, non-optional read access (`GET /api/conversations/monitor`)
  and can never send — that's a deliberate child-safety design
  decision, not a limitation to work around. Messages are scanned for
  grooming-pattern red flags (off-platform contact requests, phone
  numbers, secrecy language) and flagged instantly.
- **`parent_tutor`** — a parent messaging a tutor directly (scheduling,
  questions) once they have a confirmed booking together. Only a
  parent can start one; both sides can then send freely. The
  child-safety flagging does **not** apply here — it exists to protect
  a minor, and applying it to an adult-to-adult conversation would be
  a category error, not a safety measure.

Real-time delivery via Socket.IO (`src/realtime/socket.js`), JWT-
authenticated on the handshake, with server-side re-verification of
room access — never trusts what the client claims.

## Curriculum, lesson materials, and assignments

- **Curriculum** (`/api/curriculum`) — reference units tutors plan
  around. `super_admin` manages the global library; `school_admin`
  manages their own school's. Visibility for everyone else is scoped:
  global units are visible to all, school-specific units only to
  people actually connected to that school (its own parents/children,
  or a tutor with a confirmed booking to one of that school's
  children).
- **Lesson materials** (`/api/lesson-materials`) — a tutor's own
  uploaded content library (video/PDF/etc.), optionally tagged to a
  curriculum unit. Visible to the tutor always, and to a parent/child
  only once they have a confirmed booking with that tutor.
- **Assignments** (`/api/assignments`) — a tutor assigns work to a
  specific child (gated on a confirmed booking), the child — or the
  parent, submitting on their behalf — submits, the tutor grades.
  Single-row lifecycle (`assigned` → `submitted` → `graded`); a
  graded assignment can't be resubmitted.

File uploads use the same provider-swap pattern as payments:
`STORAGE_PROVIDER=local` (default, works with zero setup — saves to
`./uploads`, served at `/uploads`) or `STORAGE_PROVIDER=cloudinary`
(real SDK integration, **untested in this environment** — no
Cloudinary account configured here, same honest caveat as the
Paystack provider).

## Testing

Automated tests (Jest + Supertest) run against a **real, separate Postgres
database** (`lessonteacher_test`), not mocks — every test hits the actual
HTTP layer and the actual database.

```bash
# one-time setup
sudo -u postgres psql -c "CREATE DATABASE lessonteacher_test OWNER lessonteacher;"

npm test              # run the full suite
npm run test:coverage # same, with a coverage report
```

Current coverage: **~78% statements** across 95 tests. The meaningful
gaps are honest, not oversights:
- `paystackProvider.js` and `cloudinaryProvider.js` — can't be
  exercised without live credentials for those services; the `mock`
  and `local` providers they swap for in dev mode are fully tested
  instead.
- `realtime/socket.js` — the WebSocket layer is verified manually (a
  live JWT-authenticated connection, room join, and real-time delivery
  were all confirmed working) but doesn't yet have an automated
  live-socket test in the Jest suite.

What's covered: the full auth lifecycle, referral attribution
(resolved and unresolved), skill catalog + discovery filtering/
pagination, the complete booking → payment → payout cycle including
the "must be paid to mark completed" gate, admin user/settings
management, school profile/roster management, the mobile offline-sync
engine (pull/push, ownership checks, password-hash leakage
prevention), and — most importantly — the **entire child-safety
messaging gate**: blocked with no booking, blocked with only a pending
booking, allowed once confirmed, the grooming-pattern flagging system,
parent-only monitoring access, and that a parent can never send a
message directly.

Two real bugs were caught and fixed by writing these tests, neither of
which surfaced during extensive manual `curl` testing:
1. The SQL placeholder compiler mistook an `@` inside a string literal
   (e.g. an email address written directly into a query) for a named
   parameter.
2. A query with zero placeholders but a stray argument passed at the
   call site sent Postgres a bind parameter it didn't expect,
   500-ing the entire tutor discovery endpoint under specific filter
   combinations.

## Project layout

```
src/
  config/db.js          — the Postgres adapter (see above)
  db/
    schema.postgres.sql — applied automatically on boot
    seedSuperAdmin.js, seedSkills.js
  controllers/           — one file per resource, all async
  routes/                 — Express routers, wrap handlers in asyncHandler
  middleware/             — auth (JWT), error handling
  services/
    paymentProviders/     — mock + real Paystack, swappable via env
    contentFlagging.js    — basic pattern-based message safety flags
  realtime/socket.js       — Socket.IO setup
  utils/                    — jwt, referral codes, settings, asyncHandler
```

## Database migrations

Baseline: `src/db/schema.postgres.sql` (idempotent additions). Anything destructive or data-moving: `npm run migrate:new -- name`, then `npm run migrate` (also runs automatically at server start, serialised by an advisory lock across replicas). See `src/db/migrations/README.md`.
