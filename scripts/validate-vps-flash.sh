#!/usr/bin/env bash
set -euo pipefail

HOST="${FLASH_VPS_HOST:-jason@de.bayton.net}"
SSH_PORT="${FLASH_VPS_SSH_PORT:-2222}"
APP_CONTAINER="${FLASH_VPS_APP_CONTAINER:-flash-mdm}"
CADDY_CONTAINER="${FLASH_VPS_CADDY_CONTAINER:-caddy-edge}"
PUBLIC_URL="${FLASH_PUBLIC_URL:-https://flash-mdm.bayton.org}"
APP_DIR="${FLASH_APP_DIR:-/opt/flash-mdm}"
DB_USER="${FLASH_DB_USER:-flashmdm}"
DB_NAME="${FLASH_DB_NAME:-flash_mdm}"

failures=0
SSH=(ssh -p "$SSH_PORT" "$HOST")

check() {
  local label="$1"
  shift
  if "$@"; then
    printf 'ok - %s\n' "$label"
  else
    printf 'not ok - %s\n' "$label" >&2
    failures=$((failures + 1))
  fi
}

check "public URL returns HTML" \
  bash -c "curl -fsS --max-time 20 '$PUBLIC_URL/' >/dev/null"

check "public auth config is reachable" \
  bash -c "curl -fsS --max-time 20 '$PUBLIC_URL/api/auth/config' | grep -q 'invite_only_registration'"

check "Caddy container is active" \
  "${SSH[@]}" "sudo lxc exec '$CADDY_CONTAINER' -- systemctl is-active --quiet caddy"

check "Caddy routes the public hostname" \
  "${SSH[@]}" "sudo lxc exec '$CADDY_CONTAINER' -- grep -q 'flash-mdm.bayton.org' /etc/caddy/Caddyfile"

check "Caddy has a certificate for the public hostname" \
  "${SSH[@]}" "sudo lxc exec '$CADDY_CONTAINER' -- bash -lc 'openssl s_client -connect flash-mdm.bayton.org:443 -servername flash-mdm.bayton.org </dev/null 2>/dev/null | openssl x509 -noout -subject | grep -q flash-mdm.bayton.org'"

check "Flash service is active" \
  "${SSH[@]}" "sudo lxc exec '$APP_CONTAINER' -- systemctl is-active --quiet flashmdm"

check "Flash durable queue worker is active" \
  "${SSH[@]}" "sudo lxc exec '$APP_CONTAINER' -- systemctl is-active --quiet flashmdm-worker"

check "PostgreSQL service is active" \
  "${SSH[@]}" "sudo lxc exec '$APP_CONTAINER' -- systemctl is-active --quiet postgresql"

check "inner Caddy is disabled/inactive" \
  "${SSH[@]}" "sudo lxc exec '$APP_CONTAINER' -- bash -lc '! systemctl is-active --quiet caddy'"

check "PostgreSQL major version is 17" \
  "${SSH[@]}" "sudo lxc exec '$APP_CONTAINER' -- sudo -u postgres psql -Atc 'show server_version;' | grep -q '^17\\.'"

check "database has restored Flash schema" \
  "${SSH[@]}" "sudo lxc exec '$APP_CONTAINER' -- sudo -u postgres psql -d '$DB_NAME' -Atc \"select count(*) >= 60 from information_schema.tables where table_schema='public';\" | grep -q t"

check "migrations are present" \
  "${SSH[@]}" "sudo lxc exec '$APP_CONTAINER' -- sudo -u postgres psql -d '$DB_NAME' -Atc \"select count(*) >= 50 from _migrations;\" | grep -q t"

check "cron is enabled for scheduled maintenance functions" \
  "${SSH[@]}" "sudo lxc exec '$APP_CONTAINER' -- bash -lc 'systemctl is-active --quiet cron && crontab -u jason -l | grep -q run-vps-scheduled.sh.*geofence-check-scheduled && crontab -u jason -l | grep -q run-vps-scheduled.sh.*sync-reconcile-scheduled && crontab -u jason -l | grep -q run-vps-scheduled.sh.*licensing-reconcile-scheduled && crontab -u jason -l | grep -q run-vps-scheduled.sh.*cleanup-scheduled'"

check "workflow cron is either explicitly enabled or explicitly paused" \
  "${SSH[@]}" "sudo lxc exec '$APP_CONTAINER' -- bash -lc 'crontab -u jason -l | grep -Eq \"^([^#].*run-vps-scheduled.sh workflow-cron-scheduled|# paused .*workflow-cron-scheduled)\"'"

check "VPS URL is configured" \
  "${SSH[@]}" "sudo lxc exec '$APP_CONTAINER' -- bash -lc 'cd \"$APP_DIR\" && grep -q \"^URL=\\\"$PUBLIC_URL\\\"\" .env'"

check "database URL points at localhost" \
  "${SSH[@]}" "sudo lxc exec '$APP_CONTAINER' -- bash -lc 'cd \"$APP_DIR\" && grep -q \"^DATABASE_URL=.*localhost\" .env'"

check "encryption key is a real 32-byte value" \
  "${SSH[@]}" "sudo lxc exec '$APP_CONTAINER' -- bash -lc 'cd \"$APP_DIR\" && node -r dotenv/config -e \"const key = process.env.ENCRYPTION_MASTER_KEY ?? \\\"\\\"; const ok = /^[0-9a-f]{64}$/i.test(key) || Buffer.from(key, \\\"base64\\\").length === 32; process.exit(ok ? 0 : 1)\"'"

if "${SSH[@]}" "sudo lxc exec '$APP_CONTAINER' -- test -f /etc/flash-mdm/auto-deploy.env"; then
  check "automatic deployment webhook service is active" \
    "${SSH[@]}" "sudo lxc exec '$APP_CONTAINER' -- systemctl is-active --quiet flashmdm-auto-deploy-webhook"
  check "deployment webhook route is present before the Flash catch-all proxy" \
    "${SSH[@]}" "sudo lxc exec '$CADDY_CONTAINER' -- bash -lc 'awk '\''/handle \/api\/deploy\/webhook/{ webhook=NR } /reverse_proxy .*:3000/{ app=NR } END { exit !(webhook && app && webhook < app) }'\'' /etc/caddy/Caddyfile'"
  check "public webhook route does not accept unsigned GET requests" \
    bash -c 'code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 "$1/api/deploy/webhook"); test "$code" = 404' _ "$PUBLIC_URL"
fi

if (( failures > 0 )); then
  printf '\n%d validation check(s) failed.\n' "$failures" >&2
  exit 1
fi

printf '\nAll VPS Flash checks passed.\n'
