#!/usr/bin/env bash
set -euo pipefail

[[ $# -eq 1 && "$1" =~ ^[0-9a-f]{40}$ ]] || {
  echo "A 40-character lowercase deployment commit is required" >&2
  exit 64
}

exec /usr/bin/systemctl start --no-block "flashmdm-auto-deploy@$1.service"
