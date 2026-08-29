#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${FLASH_AUTO_DEPLOY_CONFIG_FILE:-/etc/flash-mdm/auto-deploy.env}"
[[ -r "$CONFIG_FILE" ]] || exit 0

# shellcheck disable=SC1090
source "$CONFIG_FILE"

required=(
  FLASH_AUTO_DEPLOY_USER
  FLASH_AUTO_DEPLOY_REPO_URL
  FLASH_AUTO_DEPLOY_REPO_REF
  FLASH_AUTO_DEPLOY_DOMAIN
  FLASH_AUTO_DEPLOY_INSTALL_DIR
  FLASH_AUTO_DEPLOY_WEBHOOK_SECRET
  FLASH_AUTO_DEPLOY_WEBHOOK_REPOSITORY
)
for key in "${required[@]}"; do
  [[ -n "${!key:-}" ]] || { echo "Missing $key in $CONFIG_FILE" >&2; exit 1; }
done

install_dir="$FLASH_AUTO_DEPLOY_INSTALL_DIR"
current_link="$install_dir/current"

mkdir -p "$install_dir/data/deploy"
exec 9>"$install_dir/data/deploy/auto-deploy.lock"
flock 9

ssh_command=()
if [[ -n "${FLASH_AUTO_DEPLOY_REPO_SSH_KEY_PATH:-}" ]]; then
  [[ -n "${FLASH_AUTO_DEPLOY_REPO_SSH_KNOWN_HOSTS_PATH:-}" && -r "$FLASH_AUTO_DEPLOY_REPO_SSH_KNOWN_HOSTS_PATH" ]] \
    || { echo "A verified repository known_hosts file is required" >&2; exit 1; }
  ssh_command=(ssh -i "$FLASH_AUTO_DEPLOY_REPO_SSH_KEY_PATH" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$FLASH_AUTO_DEPLOY_REPO_SSH_KNOWN_HOSTS_PATH")
fi

run_as_deploy_user() {
  if (( ${#ssh_command[@]} )); then
    runuser -u "$FLASH_AUTO_DEPLOY_USER" -- env \
      GIT_TERMINAL_PROMPT=0 \
      "GIT_SSH_COMMAND=${ssh_command[*]}" \
      "$@"
  else
    runuser -u "$FLASH_AUTO_DEPLOY_USER" -- env GIT_TERMINAL_PROMPT=0 "$@"
  fi
}

requested_sha="${1:-}"
[[ "$requested_sha" =~ ^[0-9a-f]{40}$ ]] || { echo "A 40-character deployment commit is required" >&2; exit 1; }
remote_sha=$(run_as_deploy_user git ls-remote "$FLASH_AUTO_DEPLOY_REPO_URL" "$FLASH_AUTO_DEPLOY_REPO_REF" | awk 'NR == 1 { print $1 }')
[[ "$remote_sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Could not resolve configured repository ref" >&2; exit 1; }
if [[ "$remote_sha" != "$requested_sha" ]]; then
  echo "Webhook commit $requested_sha is no longer the configured ref; waiting for the next delivery"
  exit 0
fi

active_sha=$(run_as_deploy_user git -c safe.directory="$(readlink -f "$current_link")" -C "$(readlink -f "$current_link")" rev-parse HEAD)
if [[ "$active_sha" == "$remote_sha" ]]; then
  echo "Flash MDM is already at $active_sha"
  exit 0
fi

# The installer generates runtime routes and service units, so it must come from
# the signed target commit rather than the previously active release. Otherwise
# installer changes take effect one deployment late even though the code symlink
# already reports the new commit.
release_source_root=$(run_as_deploy_user mktemp -d "$install_dir/data/deploy/release-source.XXXXXX")
release_source="$release_source_root/source"
cleanup_release_source() {
  run_as_deploy_user rm -rf -- "$release_source_root"
}
trap cleanup_release_source EXIT
run_as_deploy_user git clone --no-checkout "$FLASH_AUTO_DEPLOY_REPO_URL" "$release_source"
run_as_deploy_user git -C "$release_source" checkout --detach "$remote_sha"
staged_sha=$(run_as_deploy_user git -C "$release_source" rev-parse HEAD)
[[ "$staged_sha" == "$remote_sha" ]] || { echo "Staged deployment source does not match the signed commit" >&2; exit 1; }
installer="$release_source/install.sh"
[[ -x "$installer" ]] || { echo "Target release has no executable installer" >&2; exit 1; }

echo "Deploying Flash MDM $active_sha -> $remote_sha"
env \
  FLASH_ALLOW_ROOT_INSTALL=true \
  FLASH_INSTALL_RUN_AS_USER="$FLASH_AUTO_DEPLOY_USER" \
  FLASH_DOMAIN="$FLASH_AUTO_DEPLOY_DOMAIN" \
  FLASH_INSTALL_DIR="$install_dir" \
  FLASH_EXTERNAL_CADDY="${FLASH_AUTO_DEPLOY_EXTERNAL_CADDY:-false}" \
  FLASH_REPO_URL="$FLASH_AUTO_DEPLOY_REPO_URL" \
  FLASH_RELEASE_REF="$remote_sha" \
  FLASH_REPO_SSH_KEY_PATH="${FLASH_AUTO_DEPLOY_REPO_SSH_KEY_PATH:-}" \
  FLASH_REPO_SSH_KNOWN_HOSTS_PATH="${FLASH_AUTO_DEPLOY_REPO_SSH_KNOWN_HOSTS_PATH:-}" \
  FLASH_AUTO_DEPLOY=true \
  FLASH_AUTO_DEPLOY_USER="$FLASH_AUTO_DEPLOY_USER" \
  FLASH_AUTO_DEPLOY_REPO_URL="$FLASH_AUTO_DEPLOY_REPO_URL" \
  FLASH_AUTO_DEPLOY_REPO_REF="$FLASH_AUTO_DEPLOY_REPO_REF" \
  FLASH_AUTO_DEPLOY_REPO_SSH_KEY_PATH="${FLASH_AUTO_DEPLOY_REPO_SSH_KEY_PATH:-}" \
  FLASH_AUTO_DEPLOY_REPO_SSH_KNOWN_HOSTS_PATH="${FLASH_AUTO_DEPLOY_REPO_SSH_KNOWN_HOSTS_PATH:-}" \
  FLASH_AUTO_DEPLOY_WEBHOOK_SECRET="$FLASH_AUTO_DEPLOY_WEBHOOK_SECRET" \
  FLASH_AUTO_DEPLOY_WEBHOOK_REPOSITORY="$FLASH_AUTO_DEPLOY_WEBHOOK_REPOSITORY" \
  FLASH_AUTO_DEPLOY_WEBHOOK_PORT="$FLASH_AUTO_DEPLOY_WEBHOOK_PORT" \
  FLASH_AUTO_DEPLOY_WEBHOOK_BIND_ADDRESS="${FLASH_AUTO_DEPLOY_WEBHOOK_BIND_ADDRESS:-}" \
  bash "$installer"
