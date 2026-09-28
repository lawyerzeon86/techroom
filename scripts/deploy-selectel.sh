#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/var/www/duisun
REPO_URL=https://github.com/lawyerzeon86/techroom.git
BRANCH=main
ENV_FILE="$APP_DIR/.env.production"
ROOT_DB_ENV=/root/duisun-db.env
ROOT_ADMIN_ENV=/root/duisun-admin.env

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root"
  exit 1
fi

mkdir -p "$APP_DIR"

if [ ! -d "$APP_DIR/.git" ]; then
  rm -rf "$APP_DIR"/* "$APP_DIR"/.[!.]* "$APP_DIR"/..?* 2>/dev/null || true
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$APP_DIR"
else
  cd "$APP_DIR"
  git fetch origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
fi

cd "$APP_DIR"

if [ ! -f "$ROOT_DB_ENV" ]; then
  echo "Missing $ROOT_DB_ENV"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ROOT_DB_ENV"
set +a

if [ ! -f "$ROOT_ADMIN_ENV" ]; then
  ADMIN_PASSWORD="$(openssl rand -base64 30 | tr -d '\n/=+' | head -c 24)"
  ADMIN_SESSION_SECRET="$(openssl rand -hex 32)"
  CRON_SYNC_SECRET="$(openssl rand -hex 32)"
  cat >"$ROOT_ADMIN_ENV" <<EOF
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_SESSION_SECRET=$ADMIN_SESSION_SECRET
CRON_SYNC_SECRET=$CRON_SYNC_SECRET
EOF
  chmod 600 "$ROOT_ADMIN_ENV"
fi

set -a
# shellcheck disable=SC1090
source "$ROOT_ADMIN_ENV"
set +a

cat >"$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
DATABASE_URL=$DATABASE_URL
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_SESSION_SECRET=$ADMIN_SESSION_SECRET
CRON_SYNC_SECRET=$CRON_SYNC_SECRET
TELEGRAM_WEBAPP_URL=https://duisun.ru/telegram
MAX_WEBAPP_URL=https://duisun.ru/max
WHATSAPP_STORE_URL=https://duisun.ru/
YOOKASSA_RETURN_URL=https://duisun.ru/payment/return
GITHUB_SYNC_REPOSITORY=lawyerzeon86/techroom
ENABLE_STARTUP_MARKETPLACE_TASKS=0
SYNC_MARKETPLACE_STOCKS=1
SYNC_MARKETPLACE_PRICES=1
SYNC_OZON_PRICES=1
EOF
chmod 600 "$ENV_FILE"

npm ci
npm run build

pm2 delete techroom >/dev/null 2>&1 || true
pm2 delete duisun >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root >/tmp/duisun-pm2-startup.txt 2>&1 || true

cat >/etc/nginx/sites-available/duisun <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name duisun.ru www.duisun.ru;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
    }

    location = /health {
        access_log off;
        proxy_pass http://127.0.0.1:3000/api/health;
        proxy_set_header Host $host;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/duisun /etc/nginx/sites-enabled/duisun
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

sleep 3

echo "=== PM2 ==="
pm2 status

echo "=== LOCAL HTTP ==="
curl -I --max-time 15 http://127.0.0.1:3000/ || true

echo "=== NGINX HTTP ==="
curl -I --max-time 15 -H 'Host: duisun.ru' http://127.0.0.1/ || true

echo "=== DNS ==="
DNS_IP="$(getent ahostsv4 duisun.ru 2>/dev/null | awk 'NR==1{print $1}')"
echo "duisun.ru -> ${DNS_IP:-not-resolved}"

if [ "${DNS_IP:-}" = "135.106.196.81" ]; then
  certbot --nginx -d duisun.ru -d www.duisun.ru --non-interactive --agree-tos --register-unsafely-without-email --redirect || true
else
  echo "SSL skipped: point duisun.ru A record to 135.106.196.81 first."
fi

echo
echo "DUISUN DEPLOYED"
echo "Admin credentials are stored only in $ROOT_ADMIN_ENV"
echo "Database credentials are stored only in $ROOT_DB_ENV"
echo "Marketplace/payment/messenger secrets are intentionally not written to GitHub."
