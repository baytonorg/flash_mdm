#!/usr/bin/env bash
set -euo pipefail

endpoint="${1:-}"
case "$endpoint" in
  cleanup-scheduled|geofence-check-scheduled|licensing-reconcile-scheduled|sync-reconcile-scheduled|workflow-cron-scheduled) ;;
  *)
    logger -t flashmdm-cron -- "Rejected unknown scheduled endpoint: ${endpoint:-<empty>}"
    exit 64
    ;;
esac

lock_dir="${FLASH_CRON_LOCK_DIR:-/tmp/flashmdm-cron}"
timeout_seconds="${FLASH_CRON_TIMEOUT_SECONDS:-240}"
mkdir -p "$lock_dir"

exec 9>"$lock_dir/$endpoint.lock"
if ! flock -n 9; then
  logger -t flashmdm-cron -- "$endpoint skipped because the previous run is still active"
  exit 0
fi

response_file=$(mktemp "$lock_dir/$endpoint.response.XXXXXX")
trap 'rm -f "$response_file"' EXIT

if ! curl --fail --show-error --silent \
  --max-time "$timeout_seconds" \
  --output "$response_file" \
  "http://localhost:3000/api/$endpoint"; then
  logger -t flashmdm-cron -- "$endpoint failed or timed out after ${timeout_seconds}s"
  exit 1
fi

if ! node - "$response_file" <<'NODE'
const fs = require('fs');
const body = fs.readFileSync(process.argv[2], 'utf8').trim();
if (!body) process.exit(0);
try {
  const parsed = JSON.parse(body);
  if (parsed?.error || Number(parsed?.stats?.errors ?? 0) > 0) process.exit(1);
} catch {
  process.exit(1);
}
NODE
then
  logger -t flashmdm-cron -- "$endpoint returned an unsuccessful response"
  exit 1
fi
