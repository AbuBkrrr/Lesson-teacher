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

## Features: missing or partial
1. **Audition types** (video, live, portfolio, challenge), linked child + skill, parent **rating 1–5, feedback, accept/reject decision**. Today it is only a status + video URL.
2. **Child profile fields**: age, school, learning needs (only name + grade today).
3. **Bookings**: skill link, end time / duration, stored price, **recurring bookings** (weekly series).
4. **Lesson record + tutor progress notes** after each lesson (content, feedback, score).
5. **Progress tracking per child per skill** (level, lessons completed, average score) and **progress report** screens for parent and child. Only badges/streaks exist.
6. Tutor skill proficiency lacks `advanced`; only one evidence link per skill.
7. **Lesson room**: no **screen share**, no **whiteboard**, no in-call chat or shared files.
8. **Desktop QR pairing**: the code flow exists; QR display (desktop) + scan (phone) is missing.
9. **Deployment for a single VPS**: `docker-compose.yml`, PM2 config, Nginx reverse proxy for API + WebSocket + portal, Let's Encrypt, backups, deploy guide.
10. Stack items in the table above (TypeScript, Prisma, Redux) if you still want them.
