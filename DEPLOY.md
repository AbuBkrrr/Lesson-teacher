# Deploying Lesson Teacher to one VPS

Everything (database, cache, API, web app, HTTPS) runs on a single server with Docker Compose.

## 1. Server

- Ubuntu 24.04, **2 vCPU and 2–4 GB RAM** minimum. 1 GB plans will run out of memory once video lessons start.
- A domain with an **A record** pointing at the server's public IPv4.
- Open these ports in the provider's firewall and on the server:

```bash
sudo ufw allow 22,80,443/tcp && sudo ufw allow 40000:40100/udp && sudo ufw allow 40000:40100/tcp && sudo ufw enable
```

Ports 40000–40100 carry live lesson audio/video. Without them calls connect but stay black.

- Install Docker:

```bash
curl -fsSL https://get.docker.com | sudo sh
```

## 2. Configure

```bash
sudo git clone <your repo> /opt/lesson-teacher && cd /opt/lesson-teacher/deploy
```

```bash
cp .env.example .env && nano .env
```

Set at least `DOMAIN`, `PUBLIC_IP`, `LETSENCRYPT_EMAIL`, `POSTGRES_PASSWORD`, both `JWT_*_SECRET` values (`openssl rand -hex 32`), `PAYSTACK_SECRET_KEY` and the SMTP settings.

## 3. Start with HTTPS

```bash
./init-letsencrypt.sh
```

This builds the images, starts everything, and gets the Let's Encrypt certificate. Certificates renew automatically. Test first with `STAGING=1 ./init-letsencrypt.sh` if you want to avoid Let's Encrypt rate limits.

The database schema and migrations apply automatically when the API starts.

## 4. First admin and catalog

```bash
docker compose exec api npm run seed:skills
```

```bash
docker compose exec api npm run seed:badges
```

```bash
docker compose exec api npm run seed:admin -- --email you@yourdomain.com --password 'a-long-unique-password'
```

Always pass `--password`: without it the seed uses a default password.

## 5. Paystack

In the Paystack dashboard set the webhook URL to `https://<DOMAIN>/api/payments/webhook`. Use test keys until a full test payment works, then switch to live keys and `docker compose up -d api`.

## 6. Backups

```bash
(crontab -l 2>/dev/null; echo "15 2 * * * /opt/lesson-teacher/deploy/backup.sh >> /var/log/lt-backup.log 2>&1") | crontab -
```

Backups land in `deploy/backups/` (14 days kept). Copy them off the server too. Restore commands are at the bottom of `backup.sh`.

## Updating

```bash
cd /opt/lesson-teacher && git pull && cd deploy && docker compose up -d --build
```

## Useful commands

| What | Command |
|---|---|
| Status | `docker compose ps` |
| API logs | `docker compose logs -f api` |
| PM2 process list | `docker compose exec api pm2 ls` |
| Restart API | `docker compose restart api` |
| Health | `curl https://<DOMAIN>/api/health` |

## Process management (PM2)

The API image runs `pm2-runtime` with `backend/ecosystem.config.js`: the API as one process (live lesson rooms live in its memory, so cluster mode must not be used; mediasoup already spreads media across CPU cores) and the lesson-reminder job every 5 minutes. Without Docker the same file works directly: `pm2 start ecosystem.config.js --env production`.

## Mobile and desktop apps

- **Android/iOS:** set the API URL in `mobile/eas.json` to `https://<DOMAIN>/api`, then `npx eas build -p android --profile production`.
- **Desktop (Electron):** set `VITE_API_BASE=https://<DOMAIN>/api` in `portal/.env.production`, then `npm run electron:build:win` (or `:mac`, `:linux`) in `portal/`. On the desktop app choose "Sign in with a code" and scan the QR code from the phone (Account → Linked devices).

## Scaling later

Move uploads to Cloudinary or S3 (`STORAGE_PROVIDER`), the database to a managed Postgres, and use the Kubernetes manifests in `k8s/` once one server is not enough.
