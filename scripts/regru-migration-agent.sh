#!/usr/bin/env bash
set -Eeuo pipefail

ACTION="${1:-help}"
CONFIG_FILE="${MIGRATION_CONFIG:-/root/techroom-migration.env}"
STATE_DIR="${MIGRATION_STATE_DIR:-/var/lib/techroom-migration}"
BACKUP_DIR="${MIGRATION_BACKUP_DIR:-/var/backups/techroom}"

log() { printf '[techroom-migration] %s\n' "$*"; }
die() { printf '[techroom-migration] ERROR: %s\n' "$*" >&2; exit 1; }
require_root() { [ "$(id -u)" -eq 0 ] || die 'Run this action as root.'; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"; }

load_config() {
  [ -f "$CONFIG_FILE" ] || die "Config not found: $CONFIG_FILE"
  # shellcheck disable=SC1090
  set -a; source "$CONFIG_FILE"; set +a
  : "${DOMAIN:=duisun.ru}"
  : "${APP_USER:=techroom}"
  : "${APP_DIR:=/srv/techroom/app}"
  : "${APP_PORT:=3000}"
  : "${REPO:=https://github.com/lawyerzeon86/techroom.git}"
  : "${BRANCH:=main}"
  : "${TARGET_DB_NAME:=techroom}"
  : "${TARGET_DB_USER:=techroom}"
}

need_value() {
  local name="$1"
  [ -n "${!name:-}" ] || die "$name is empty in $CONFIG_FILE"
}

install_runtime() {
  require_root
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl git nginx postgresql postgresql-client certbot python3-certbot-nginx
  if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(`.`)[0])' 2>/dev/null || printf 0)" -lt 22 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
}

preflight() {
  load_config
  require_cmd curl
  need_value SOURCE_DATABASE_URL
  need_value TARGET_DB_PASSWORD
  case "$SOURCE_DATABASE_URL" in postgresql://*|postgres://*) ;; *) die 'SOURCE_DATABASE_URL must be a PostgreSQL URL.' ;; esac
  [ "$DOMAIN" = 'duisun.ru' ] || log "Warning: configured domain is $DOMAIN"
  log "Configuration is present. No data was changed."
  if command -v psql >/dev/null 2>&1; then
    psql "$SOURCE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc 'SELECT current_database(), version();' >/dev/null
    log 'Render PostgreSQL is reachable from this server.'
  else
    log 'PostgreSQL client is not installed yet; run install after provisioning the VPS.'
  fi
}

write_app_env() {
  local env_file="/etc/techroom.env"
  umask 077
  {
    printf 'NODE_ENV=production\nPORT=%q\n' "$APP_PORT"
    printf 'DATABASE_URL=%q\n' "postgresql://${TARGET_DB_USER}:${TARGET_DB_PASSWORD}@127.0.0.1:5432/${TARGET_DB_NAME}"
    printf 'TELEGRAM_WEBAPP_URL=https://%s/telegram\n' "$DOMAIN"
    printf 'MAX_WEBAPP_URL=https://%s/max\n' "$DOMAIN"
    printf 'WHATSAPP_STORE_URL=https://%s/\n' "$DOMAIN"
    local key
    for key in ADMIN_PASSWORD ADMIN_SESSION_SECRET TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET TELEGRAM_ADMIN_CHAT_ID NEXT_PUBLIC_TELEGRAM_MANAGER_URL MAX_BOT_TOKEN MAX_WEBHOOK_SECRET MAX_ADMIN_USER_ID NEXT_PUBLIC_MAX_MANAGER_URL WHATSAPP_ACCESS_TOKEN WHATSAPP_PHONE_NUMBER_ID WHATSAPP_APP_SECRET WHATSAPP_VERIFY_TOKEN WHATSAPP_GRAPH_VERSION OZON_CLIENT_ID OZON_API_KEY OZON_WAREHOUSE_ID WB_API_TOKEN WB_WAREHOUSE_ID AVITO_CLIENT_ID AVITO_CLIENT_SECRET VK_ACCESS_TOKEN VK_GROUP_ID YANDEX_MARKET_API_KEY YANDEX_MARKET_CAMPAIGN_ID CRON_SYNC_SECRET; do
      [ -n "${!key:-}" ] && printf '%s=%q\n' "$key" "${!key}"
    done
    printf 'SYNC_MARKETPLACE_STOCKS=1\nSYNC_MARKETPLACE_PRICES=1\nSYNC_OZON_PRICES=1\n'
  } > "$env_file"
  chown root:"$APP_USER" "$env_file"
  chmod 0640 "$env_file"
}

setup_database() {
  need_value TARGET_DB_PASSWORD
  systemctl enable --now postgresql
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 \
    --set=db_user="$TARGET_DB_USER" --set=db_name="$TARGET_DB_NAME" --set=db_password="$TARGET_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'db_user', :'db_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'db_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db_name') \gexec
SQL
}

sync_code() {
  id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
  install -d -o "$APP_USER" -g "$APP_USER" "$(dirname "$APP_DIR")"
  if [ ! -d "$APP_DIR/.git" ]; then
    runuser -u "$APP_USER" -- git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
  else
    runuser -u "$APP_USER" -- git -C "$APP_DIR" fetch origin "$BRANCH"
    runuser -u "$APP_USER" -- git -C "$APP_DIR" checkout "$BRANCH"
    runuser -u "$APP_USER" -- git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
  fi
  cp /etc/techroom.env "$APP_DIR/.env.production"
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env.production"
  runuser -u "$APP_USER" -- bash -lc "cd '$APP_DIR' && npm ci && npm run build"
}

database_counts() {
  local url="$1"
  psql "$url" -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT table_name || '=' || row_count FROM (
  SELECT 'products' AS table_name, count(*)::bigint AS row_count FROM products
  UNION ALL SELECT 'orders', count(*)::bigint FROM orders
  UNION ALL SELECT 'order_items', count(*)::bigint FROM order_items
  UNION ALL SELECT 'marketplace_orders', count(*)::bigint FROM marketplace_orders
) counts ORDER BY table_name;
SQL
}

migrate_database() {
  need_value SOURCE_DATABASE_URL
  mkdir -p "$STATE_DIR" "$BACKUP_DIR"
  chmod 0700 "$STATE_DIR" "$BACKUP_DIR"
  local stamp dump target_url
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  dump="$BACKUP_DIR/render-$stamp.dump"
  target_url="postgresql://${TARGET_DB_USER}:${TARGET_DB_PASSWORD}@127.0.0.1:5432/${TARGET_DB_NAME}"
  log 'Creating a consistent Render database backup.'
  pg_dump "$SOURCE_DATABASE_URL" --format=custom --no-owner --no-acl --file="$dump"
  database_counts "$SOURCE_DATABASE_URL" > "$STATE_DIR/source-counts.txt"
  log 'Restoring the backup into REG.RU PostgreSQL.'
  pg_restore --dbname="$target_url" --clean --if-exists --no-owner --no-acl "$dump"
  database_counts "$target_url" > "$STATE_DIR/target-counts.txt"
  diff -u "$STATE_DIR/source-counts.txt" "$STATE_DIR/target-counts.txt"
  sha256sum "$dump" > "$dump.sha256"
  log "Database migrated and verified. Backup: $dump"
}

write_service() {
  cat > /etc/systemd/system/techroom.service <<EOF
[Unit]
Description=TechRoom Next.js store
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=/etc/techroom.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$APP_DIR/.next

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now techroom
}

write_nginx() {
  cat > "/etc/nginx/sites-available/$DOMAIN" <<EOF
server {
  listen 80;
  listen [::]:80;
  server_name $DOMAIN www.$DOMAIN;
  client_max_body_size 20m;
  location / {
    proxy_pass http://127.0.0.1:$APP_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
EOF
  ln -sfn "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
}

verify_local() {
  curl -fsS --max-time 20 "http://127.0.0.1:$APP_PORT/api/health" | grep -q '"ok":true'
  curl -fsS --max-time 20 -H "Host: $DOMAIN" http://127.0.0.1/api/products >/dev/null
  systemctl is-active --quiet techroom
  systemctl is-active --quiet nginx
  log 'Application, database, and reverse proxy checks passed.'
}

configure_webhooks() {
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && curl -fsS --max-time 30 \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
    --data-urlencode "url=https://${DOMAIN}/api/telegram/webhook" \
    --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET:-}" >/dev/null
  log 'Telegram webhook updated when configured. Verify WhatsApp/MAX callbacks in their provider panels.'
}

install_all() {
  require_root
  load_config
  need_value SOURCE_DATABASE_URL
  need_value TARGET_DB_PASSWORD
  install_runtime
  setup_database
  write_app_env
  sync_code
  migrate_database
  write_service
  write_nginx
  verify_local
  cat > "$STATE_DIR/cutover-ready.txt" <<EOF
domain=$DOMAIN
server_ip=$(curl -4fsS --max-time 10 https://api.ipify.org || true)
verified_at=$(date -u +%FT%TZ)
next=Point the REG.RU A records for @ and www to server_ip, then run: $0 finalize
EOF
  cat "$STATE_DIR/cutover-ready.txt"
}

finalize() {
  require_root
  load_config
  verify_local
  need_value LETSENCRYPT_EMAIL
  certbot --nginx --non-interactive --agree-tos --redirect \
    --email "$LETSENCRYPT_EMAIL" -d "$DOMAIN" -d "www.$DOMAIN"
  curl -fsS --max-time 30 "https://$DOMAIN/api/health" | grep -q '"ok":true'
  configure_webhooks
  log 'Cutover verified. Keep Render online for at least 48 hours as rollback.'
}

case "$ACTION" in
  preflight) preflight ;;
  install) install_all ;;
  verify) load_config; verify_local ;;
  finalize) finalize ;;
  *)
    cat <<EOF
Usage: MIGRATION_CONFIG=/root/techroom-migration.env $0 ACTION

Actions:
  preflight  Validate configuration and Render database access without changes
  install    Install runtime, migrate data, deploy app, and verify locally
  verify     Re-run local application checks
  finalize   Issue SSL and update webhooks after DNS points to the VPS
EOF
    ;;
esac
