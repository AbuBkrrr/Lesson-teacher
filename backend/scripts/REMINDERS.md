# Lesson reminders

`scripts/sendLessonReminders.js` notifies both the parent and the tutor on a
confirmed booking shortly before it starts. It does not schedule itself —
run it on an external schedule.

## Usage

```
npm run send-reminders
```

Env vars (optional, defaults shown):
- `REMINDER_LOOKAHEAD_MINUTES=60` — how far ahead to look for a booking's start
- `REMINDER_WINDOW_MINUTES=15` — width of the catch window; run the script
  more often than this and every booking is still reminded exactly once

## Scheduling it

This process has no built-in scheduler. Wire it up with whatever the
deployment target offers, e.g.:

```cron
*/10 * * * * cd /path/to/backend && npm run send-reminders >> /var/log/lesson-reminders.log 2>&1
```

or an equivalent scheduled job on your hosting platform (Render Cron Jobs,
Heroku Scheduler, a Kubernetes CronJob, etc.) — anything that invokes
`node scripts/sendLessonReminders.js` every 5-10 minutes.

Sends are idempotent via `bookings.reminder_sent_at`, so overlapping or
re-run invocations are safe.
