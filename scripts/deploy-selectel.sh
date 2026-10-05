#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/var/www/duisun
REPO_URL=https://github.com/lawyerzeon86/techroom.git
BRANCH=main
ENV_FILE="$APP_DIR/.env.production"
ROOT_DB_ENV=/root/duisun-db.env
ROOT_ADMIN_ENV=/root/duisun-admin.env
ROOT_INTEGRATIONS_ENV=/root/duisun-integrations.env

if [ "$(id -u)" -ne 0 ]; then echo "Run as root"; exit 1; fi
mkdir -p "$APP_DIR"

if [ -f "$ENV_FILE" ] && [ ! -f "$ROOT_INTEGRATIONS_ENV" ]; then
  grep -E '^(WB_API_TOKEN|WB_FEEDBACK_TOKEN|WB_WAREHOUSE_ID|OZON_CLIENT_ID|OZON_API_KEY|OZON_WAREHOUSE_ID|OZON_DESCRIPTION_ATTRIBUTE_ID|AVITO_CLIENT_ID|AVITO_CLIENT_SECRET|AVITO_USER_ID|YANDEX_MARKET_API_KEY|YANDEX_MARKET_BUSINESS_ID|VK_ACCESS_TOKEN|VK_GROUP_ID|TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|TELEGRAM_ADMIN_CHAT_ID|MAX_BOT_TOKEN|MAX_WEBHOOK_SECRET|MAX_ADMIN_USER_ID|WHATSAPP_ACCESS_TOKEN|WHATSAPP_PHONE_NUMBER_ID|WHATSAPP_APP_SECRET|WHATSAPP_VERIFY_TOKEN|WHATSAPP_GRAPH_VERSION|YOOKASSA_SHOP_ID|YOOKASSA_SECRET_KEY|OPENAI_API_KEY|OPENAI_MODEL)=' "$ENV_FILE" > "$ROOT_INTEGRATIONS_ENV" || true
  chmod 600 "$ROOT_INTEGRATIONS_ENV"
fi

if [ ! -d "$APP_DIR/.git" ]; then
  rm -rf "$APP_DIR"/* "$APP_DIR"/.[!.]* "$APP_DIR"/..?* 2>/dev/null || true
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$APP_DIR"
else
  cd "$APP_DIR"
  git config --global --add safe.directory "$APP_DIR" >/dev/null 2>&1 || true
  git fetch origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
fi
cd "$APP_DIR"

[ -f "$ROOT_DB_ENV" ] || { echo "Missing $ROOT_DB_ENV"; exit 1; }
set -a; source "$ROOT_DB_ENV"; set +a

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
set -a; source "$ROOT_ADMIN_ENV"; set +a

if [ -s "$ROOT_INTEGRATIONS_ENV" ] && grep -q '^TELEGRAM_BOT_TOKEN=' "$ROOT_INTEGRATIONS_ENV" && ! grep -q '^TELEGRAM_WEBHOOK_SECRET=' "$ROOT_INTEGRATIONS_ENV"; then
  printf '\nTELEGRAM_WEBHOOK_SECRET=%s\n' "$(openssl rand -hex 32)" >> "$ROOT_INTEGRATIONS_ENV"
fi

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
SYNC_MARKETPLACE_STOCKS=0
SYNC_MARKETPLACE_PRICES=0
SYNC_WB_PRICES=0
SYNC_OZON_PRICES=0
SYNC_YANDEX_PRICES=0
SYNC_AVITO_PRICES=0
EOF
if [ -s "$ROOT_INTEGRATIONS_ENV" ]; then cat "$ROOT_INTEGRATIONS_ENV" >> "$ENV_FILE"; fi
chmod 600 "$ENV_FILE"

npm ci
node scripts/finalize-selectel.mjs
npm run build
pm2 delete techroom >/dev/null 2>&1 || true
pm2 delete duisun >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root >/tmp/duisun-pm2-startup.txt 2>&1 || true

cat >/usr/local/bin/duisun-sync-run <<'SYNC'
#!/usr/bin/env bash
set -euo pipefail
MODE=${1:-core}
cd /var/www/duisun
set -a; source .env.production; set +a
case "$MODE" in
  core) URL='http://127.0.0.1:3000/api/internal/marketplace-sync'; OUT=/var/log/duisun-sync-core-last.json; TIMEOUT=240 ;;
  communications) URL='http://127.0.0.1:3000/api/internal/marketplace-sync?force=1&communications=1'; OUT=/var/log/duisun-sync-communications-last.json; TIMEOUT=240 ;;
  transfers) URL='http://127.0.0.1:3000/api/internal/marketplace-sync?force=1&transfers=1'; OUT=/var/log/duisun-sync-transfers-last.json; TIMEOUT=300 ;;
  *) exit 2 ;;
esac
CFG=$(mktemp /run/duisun-curl.XXXXXX)
trap 'rm -f "$CFG"' EXIT
chmod 600 "$CFG"
printf 'header = "x-cron-secret: %s"\n' "$CRON_SYNC_SECRET" > "$CFG"
RESULT=$(mktemp /run/duisun-result.XXXXXX)
trap 'rm -f "$CFG" "$RESULT"' EXIT
if flock -E 75 -n /run/duisun-marketplace-sync.lock curl -fsS --max-time "$TIMEOUT" -X POST --config "$CFG" "$URL" > "$RESULT"; then
  install -m 600 "$RESULT" "$OUT"
  node -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(r.ok!==true||r.partial===true)process.exit(1)' "$RESULT"
else
  status=$?
  [ "$status" = 75 ] && exit 0
  exit "$status"
fi
SYNC
chmod 700 /usr/local/bin/duisun-sync-run

for mode in core communications transfers; do
cat >"/usr/local/bin/duisun-sync-$mode" <<EOF
#!/usr/bin/env bash
exec /usr/local/bin/duisun-sync-run $mode
EOF
chmod 700 "/usr/local/bin/duisun-sync-$mode"
cat >"/etc/systemd/system/duisun-sync-$mode.service" <<EOF
[Unit]
Description=Duisun $mode marketplace sync
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/duisun-sync-$mode
User=root
EOF
done

cat >/etc/systemd/system/duisun-sync-core.timer <<'UNIT'
[Unit]
Description=Duisun core marketplace sync every 15 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
RandomizedDelaySec=45
Persistent=true
[Install]
WantedBy=timers.target
UNIT
cat >/etc/systemd/system/duisun-sync-communications.timer <<'UNIT'
[Unit]
Description=Duisun reviews and questions sync every 2 hours
[Timer]
OnBootSec=10min
OnUnitActiveSec=15min
RandomizedDelaySec=45
Persistent=true
[Install]
WantedBy=timers.target
UNIT
cat >/etc/systemd/system/duisun-sync-transfers.timer <<'UNIT'
[Unit]
Description=Duisun cross-marketplace transfer sync every 6 hours
[Timer]
OnBootSec=30min
OnUnitActiveSec=6h
RandomizedDelaySec=15min
Persistent=true
[Install]
WantedBy=timers.target
UNIT

systemctl disable --now duisun-marketplace-sync.timer 2>/dev/null || true
systemctl daemon-reload
systemctl enable --now duisun-sync-core.timer duisun-sync-communications.timer duisun-sync-transfers.timer

install -d -m 700 /root/duisun-backups
cat >/usr/local/bin/duisun-backup <<'BACKUP'
#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /var/www/duisun
set -a; source .env.production; set +a
STAMP=$(date -u +%Y%m%dT%H%M%S)
pg_dump --dbname="$DATABASE_URL" --format=custom --file="/root/duisun-backups/database-$STAMP.dump"
tar -czf "/root/duisun-backups/config-$STAMP.tar.gz" /root/duisun-db.env /root/duisun-admin.env /root/duisun-integrations.env /etc/nginx/sites-available/duisun
BACKUP
chmod 700 /usr/local/bin/duisun-backup
cat >/etc/systemd/system/duisun-backup.service <<'UNIT'
[Unit]
Description=Duisun private database and configuration backup
[Service]
Type=oneshot
ExecStart=/usr/local/bin/duisun-backup
UNIT
cat >/etc/systemd/system/duisun-backup.timer <<'UNIT'
[Unit]
Description=Duisun daily backup
[Timer]
OnCalendar=*-*-* 01:30:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now duisun-backup.timer

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

pm2 status
systemctl list-timers --all --no-pager | grep 'duisun-sync-' || true
curl -I --max-time 15 http://127.0.0.1:3000/ || true
curl -I --max-time 15 -H 'Host: duisun.ru' http://127.0.0.1/ || true
DNS_IP="$(getent ahostsv4 duisun.ru 2>/dev/null | awk 'NR==1{print $1}')"
echo "duisun.ru -> ${DNS_IP:-not-resolved}"
if [ "${DNS_IP:-}" = "135.106.196.81" ]; then
  certbot --nginx -d duisun.ru -d www.duisun.ru --non-interactive --agree-tos --register-unsafely-without-email --redirect || true
else
  echo "SSL skipped: point duisun.ru A record to 135.106.196.81 first."
fi

# Certbot's generic two-host configuration can route www through Next.js and leak :3000
# in its canonical redirect. Once a certificate exists, restore our explicit canonical
# nginx configuration so www always redirects directly to https://duisun.ru/.
if [ -f /etc/letsencrypt/live/duisun.ru/fullchain.pem ] && [ -f "$APP_DIR/scripts/nginx-duisun-ssl.conf" ]; then
  cp "$APP_DIR/scripts/nginx-duisun-ssl.conf" /etc/nginx/sites-available/duisun
  nginx -t
  systemctl reload nginx
fi

set -a; source "$ENV_FILE"; set +a
echo "Telegram webhook is configured by the deployment runner."

echo "DUISUN DEPLOYED"
echo "Marketplace core pull: 15m; communications: 15m (alternating reviews/questions); cross-marketplace transfer: 6h."
echo "Only Ozon/WB marketplace products are eligible for the storefront; no demo product seeding."
