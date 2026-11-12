#!/usr/bin/env bash
# Nightly backup of the database and uploaded files. Keeps 14 days.
# Add to the host's crontab:  15 2 * * * /opt/lesson-teacher/deploy/backup.sh >> /var/log/lt-backup.log 2>&1
# Copy the backups/ folder off the server too (e.g. rclone to object storage).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
stamp="$(date +%Y%m%d-%H%M%S)"

docker compose exec -T db pg_dump -U lessonteacher -d lessonteacher --format=custom > "backups/db-$stamp.dump"
docker compose run --rm --no-deps -v "$PWD/backups:/backups" --entrypoint sh api -c "tar -czf /backups/uploads-$stamp.tgz -C /app uploads"

find backups -type f -mtime +14 -delete
echo "$(date -Is) backup ok: db-$stamp.dump uploads-$stamp.tgz"

# Restore:
#   docker compose exec -T db pg_restore -U lessonteacher -d lessonteacher --clean --if-exists < backups/db-<stamp>.dump
#   docker compose run --rm --no-deps -v "$PWD/backups:/backups" --entrypoint sh api -c "tar -xzf /backups/uploads-<stamp>.tgz -C /app"
