#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/www/duisun.ru/app}"
BRANCH="${BRANCH:-main}"
REPO="${REPO:-https://github.com/lawyerzeon86/techroom.git}"

mkdir -p "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$APP_DIR"
else
  cd "$APP_DIR"
  git fetch origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
fi

cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "ERROR: $APP_DIR/.env is missing. Create it in ISPmanager before deployment." >&2
  exit 2
fi

npm ci
npm run build

if command -v pm2 >/dev/null 2>&1; then
  pm2 startOrReload ecosystem.config.cjs --update-env
  pm2 save
else
  echo "ERROR: pm2 not found. Enable Node.js/PM2 in ISPmanager." >&2
  exit 3
fi

curl --fail --silent --show-error --max-time 20 http://127.0.0.1:3000/ >/dev/null

echo "TechRoom deploy completed successfully"
