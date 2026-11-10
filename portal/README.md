# Lesson Teacher — Web Portals

One web app, four portals, routed by role after login: Super Admin,
School, Tutor, and Parent. Same design system as the original mockup
(Inter font, purple accent, light gray background).

## Running it

```bash
npm install
npm run dev
```

Talks to the backend at `http://localhost:4000/api` by default — run
`lesson-teacher-backend` alongside it (see its README), or set
`VITE_API_BASE` in a `.env` file.

## Logging in

- **Super Admin**: created via `npm run seed:admin` in the backend
  project — not available through self-signup, on purpose.
- **School / Tutor / Parent**: sign up from the Lesson Teacher mobile
  app first (or via `POST /api/auth/signup`), then log in here with
  the same email/phone + password.

## What's real here

Every screen is wired to the live backend — nothing here is mocked:

- **Super Admin**: platform-wide stats, full user list with
  suspend/reactivate, school list, and an unresolved-referrals queue
  where you match a referral email/phone to the right account.
- **School**: edit school profile, look up a parent by email/phone and
  add their child to the roster, view referrals.
- **Tutor**: edit public profile (subjects, rate, bio), manage
  incoming bookings (confirm/complete/cancel) and auditions
  (mark ready with a video link/decline/complete), view referrals.
- **Parent**: browse tutors, request an audition or a booking directly,
  manage children, track bookings/auditions, view referrals.

## Referral model

There's no separate "marketer" role — every account (parent, tutor,
school) gets its own referral code the moment it's created, and can
refer anyone else. At signup, entering someone's email, phone, *or*
referral code all correctly attribute the new signup to them. Bonus
calculation isn't implemented yet (deliberately) — this only tracks
attribution and status (pending/converted/unresolved).

## Design tokens

Colors, radii, and type scale live in `src/styles/index.css` as CSS
variables (`--lt-*`), matching the original HTML mockup: Inter
typeface, `#6c5ce7` purple accent, `#f0f2f5` background, and the same
success/warning/danger palette used for status badges.

## Desktop app (Electron)

The same web portal wrapped as a native Windows/macOS/Linux app.

```bash
npm run electron:dev          # run against the Vite dev server
npm run electron:build:win    # → release/Lesson Teacher Setup 1.0.0.exe
npm run electron:build:linux  # → release/lesson-teacher-portal_1.0.0_amd64.deb
npm run electron:build:mac    # → release/mac(-arm64)/Lesson Teacher.app
npm run electron:build:all    # all three
```

All three were actually built and verified in this environment, not
just configured:
- **Windows**: a genuine NSIS installer (`.exe`, PE32 self-extracting
  archive) — built via Wine on Linux, since electron-builder can
  cross-compile Windows installers that way.
- **Linux**: a genuine `.deb`, verified with `dpkg-deb --info`/
  `--contents` — correct control metadata, our icon installed into the
  icon theme, a `.desktop` launcher entry, app bundled under `/opt`.
- **macOS**: the `.app` bundle itself builds correctly for both Intel
  and Apple Silicon. The final `.dmg` compression step genuinely
  requires macOS (`sips`, part of Apple's OS, has no Linux
  equivalent — unlike Windows builds, Wine can't emulate this one).
  Run `npm run electron:build:mac` on an actual Mac, or in CI with a
  macOS runner, to get the `.dmg`.

`electron/main.cjs` and `electron/preload.cjs` are `.cjs` deliberately
— the rest of this project is ESM (`"type": "module"` in
`package.json`), but Electron's main process is conventionally
CommonJS, so the extension sidesteps the conflict instead of fighting
it. `contextIsolation` is on and `nodeIntegration` is off — the
renderer is a plain web app talking to the REST API, it doesn't need
Node access.
