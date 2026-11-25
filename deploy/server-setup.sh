#!/usr/bin/env bash
# One-shot preparation of a fresh Debian/Ubuntu VPS for Lesson Teacher.
# Run as root:
#   curl -fsSL https://raw.githubusercontent.com/AbuBkrrr/lesson-teacher/complete-spec/deploy/server-setup.sh | bash -s -- <domain> [branch]
# <domain> must already point at this server (DNS A record). Without your own
# domain you can use <ip-with-dashes>.sslip.io, e.g. 102-68-85-97.sslip.io.
#
# It: updates the system, adds swap, opens the firewall, installs Docker,
# downloads the app to /opt/lesson-teacher and writes deploy/.env with
# freshly generated secrets. It does NOT start the app: fill in the keys in
# deploy/.env first, then run deploy/init-letsencrypt.sh.
set -euo pipefail

DOMAIN="${1:?usage: server-setup.sh <domain> [branch]}"
BRANCH="${2:-complete-spec}"
REPO="https://github.com/AbuBkrrr/lesson-teacher.git"
APP_DIR=/opt/lesson-teacher

[ "$(id -u)" = 0 ] || { echo "Run as root (or with sudo)."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "### 1/6 System update and tools"
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw openssl dnsutils

echo "### 2/6 Swap (2 GB RAM is tight while building images)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi

echo "### 3/6 Firewall: SSH, web, and live-lesson media ports"
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 40000:40100/udp
ufw allow 40000:40100/tcp
ufw --force enable

echo "### 4/6 Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "### 5/6 App code ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH" && git -C "$APP_DIR" checkout "$BRANCH" && git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
chmod +x "$APP_DIR"/deploy/*.sh

echo "### 6/6 Settings file with generated secrets"
ENV_FILE="$APP_DIR/deploy/.env"
PUBLIC_IP="$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
if [ ! -f "$ENV_FILE" ]; then
  cp "$APP_DIR/deploy/.env.example" "$ENV_FILE"
  set_kv() { sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; }
  set_kv DOMAIN "$DOMAIN"
  set_kv PUBLIC_IP "$PUBLIC_IP"
  set_kv POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_kv JWT_ACCESS_SECRET "$(openssl rand -hex 32)"
  set_kv JWT_REFRESH_SECRET "$(openssl rand -hex 32)"
  # Safe defaults until real keys are added: messages go to the logs instead of failing.
  set_kv NOTIFICATION_EMAIL_PROVIDER console
  set_kv NOTIFICATION_PUSH_PROVIDER console
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE"
else
  echo "$ENV_FILE already exists; left unchanged."
fi

resolved="$(dig +short "$DOMAIN" A | tail -1 || true)"
echo
echo "Server prepared. Public IP: $PUBLIC_IP. $DOMAIN resolves to: ${resolved:-nothing}"
[ "$resolved" = "$PUBLIC_IP" ] || echo "WARNING: $DOMAIN does not point at this server yet. HTTPS setup will fail until it does."
echo
echo "Next:"
echo "  1. nano $ENV_FILE   -> set LETSENCRYPT_EMAIL and PAYSTACK_SECRET_KEY (test key is fine to start)"
echo "  2. cd $APP_DIR/deploy && ./init-letsencrypt.sh"
