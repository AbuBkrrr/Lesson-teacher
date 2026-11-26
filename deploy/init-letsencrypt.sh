#!/usr/bin/env bash
# First-time HTTPS setup. nginx can't start without a certificate, so this:
#  1. creates a temporary self-signed certificate,
#  2. starts nginx and the app,
#  3. asks Let's Encrypt for the real certificate (HTTP-01 via webroot),
#  4. reloads nginx with it.
# Run once from the deploy/ folder after filling in .env. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Create deploy/.env first (copy .env.example)"; exit 1; }
set -a; . ./.env; set +a
: "${DOMAIN:?DOMAIN missing in .env}"
: "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL missing in .env}"
STAGING="${STAGING:-0}"   # STAGING=1 ./init-letsencrypt.sh to test without hitting rate limits

live="/etc/letsencrypt/live/$DOMAIN"

echo "### Creating a temporary certificate for $DOMAIN"
docker compose run --rm --entrypoint sh certbot -c "
  mkdir -p $live &&
  [ -s $live/fullchain.pem ] || openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout $live/privkey.pem -out $live/fullchain.pem -subj /CN=localhost"

echo "### Starting the stack"
docker compose up -d --build

echo "### Replacing it with a Let's Encrypt certificate"
docker compose run --rm --entrypoint sh certbot -c "
  if openssl x509 -in $live/fullchain.pem -noout -issuer | grep -q localhost; then
    rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf
  fi"
staging_arg=""
[ "$STAGING" = "1" ] && staging_arg="--staging"
docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  $staging_arg --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email -d "$DOMAIN" --non-interactive

docker compose exec proxy nginx -s reload
echo "### Done: https://$DOMAIN"
