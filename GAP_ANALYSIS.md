# Lesson Teacher: gap analysis (spec vs. uploaded code)

Date: 2026-11-10. Compared `My_Lesson_teacher.txt` with `lesson-teacher.zip`.

## Baseline
- Backend test suite runs and passes: **52 suites, 260 tests** (Postgres 16 + Redis).
- `project/` is an older duplicate of the root folders (2 files differ, the root copies are newer). It should be deleted.
- `backend/.env` (dev secrets) and ~400 test files in `backend/uploads/` are in the zip. Neither should ship.

## Stack: spec vs. what was built
| Area | Spec | Built |
|---|---|---|
| Language | TypeScript | JavaScript |
| ORM | Prisma | raw `pg` with a small `db.prepare()` wrapper, SQL schema + migrations |
| Mobile state | Redux Toolkit | React Context |
| Navigation | React Navigation v6 | React Navigation v7 (newer, fine) |
| Offline | PouchDB/AsyncStorage | AsyncStorage outbox (portal: IndexedDB) |
| Push | FCM | FCM via firebase-admin + Expo notifications |
| Video | plugNmeet / Jitsi | self-hosted mediasoup SFU (WebRTC) |
| Desktop | Electron + React | Electron wrapping the Vite/React portal |
| Desktop pairing | QR / WebSocket | 8-character code typed on the phone (no QR) |
| Deploy | Docker Compose, PM2, Nginx, Let's Encrypt | Dockerfiles + Kubernetes manifests + portal nginx.conf. No compose file, no PM2, no TLS setup |
| Node | v26+ | CI runs Node 22 |

## Features: built
- Auth with JWT access + rotating refresh tokens, email verification, password reset, rate limiting, linked devices.
- Roles: parent, tutor, child, super_admin, plus extras (adult_student, school_admin).
- Children CRUD, child login only through a parent's one-time invite code (parental consent).
- Skill catalog with all 6 categories (mental, physical, academic, creative, life, career). Admin can edit it.
- Tutor profile, intro video, skills with proficiency + evidence link, weekly availability with timezone, geo search.
- Tinder-style swipe discovery, saved tutors, "post a search" lesson requests that tutors apply to.
- Auditions (request → ready with video link → completed / declined).
- Bookings (single) with availability and clash checks, reschedule, .ics export, reminders.
- Payments: Paystack, Payscrow, direct transfer with proof upload, mock. Commission, sibling discount, refunds, payouts, subscriptions.
- Live lessons: mediasoup video/audio, mute, camera toggle (web + mobile).
- Real-time chat: typing, ticks, reactions, replies, attachments, edits/deletes, disappearing messages, offline outbox, parent monitoring of child chats, content flagging.
- Curriculum, lesson materials (incl. paid), assignments with submission and grading, badges, streaks, leaderboard, referrals.
- Admin: dashboard, users, tutor approval, ID verification (Didit KYC), payments, refunds, payouts, schools, announcements, settings, audit log, impersonation.
- Sentry, Prometheus metrics, load test script, CI and release workflows, 23 Playwright e2e specs.

## Status after this round (2026-11-12)

Decisions: keep JavaScript + raw SQL + React Context (TypeScript added gradually via `npm run typecheck`), keep mediasoup for video, Paystack in NGN, one 2–4 GB VPS.

| Gap | Status |
|---|---|
| Audition types, child + skill, parent rating/feedback/accept-reject | Done (API, web, mobile) |
| Child age, school, learning needs | Done (API, web, mobile) |
| Booking skill, duration, fixed price, weekly recurring series | Done (API, web; series actions on mobile) |
| Tutor lesson reports + per-skill progress, progress report screens | Done (API, web, mobile) |
| Tutor skill "advanced" + several evidence links | Done (API, web, mobile) |
| Lesson room: screen share, whiteboard, in-call chat; child can join | Done (web: all; mobile: chat, whiteboard, sees screen share) |
| Desktop QR pairing | Done (desktop shows QR, phone scans) |
| Parents had no Auditions screen on mobile | Fixed |
| Child invite sign-up missing on mobile | Fixed (code or QR) |
| Single-VPS deployment: Compose, Nginx, Let's Encrypt, PM2, backups | Done (`deploy/`, `DEPLOY.md`) |
| Full rewrite to TypeScript / Prisma / Redux | Not done, by decision |

Tests: backend Jest suite and portal Playwright suite both pass (see final report). Mobile: lint clean and Android bundle builds; not run on a device here.
