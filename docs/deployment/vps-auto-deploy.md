# VPS webhook deployment

Flash MDM can optionally receive a signed GitHub push webhook and apply the existing atomic VPS release process. It is disabled by default and does not add a listener, repository key, or deployment configuration unless `FLASH_AUTO_DEPLOY=true` and a webhook secret are explicitly supplied to `install.sh`.

## Configuration

Use an HTTPS URL for public repositories, or a read-only SSH deploy key for private repositories. Do not put the key in the application `.env` file.

```bash
export FLASH_DOMAIN=mdm.example.com
export FLASH_EXTERNAL_CADDY=true
export FLASH_REPO_URL=git@github.com:owner/flash_mdm.git
export FLASH_REPO_SSH_KEY_PATH=/opt/flash-mdm/data/deploy/repository-deploy.key
export FLASH_REPO_SSH_KNOWN_HOSTS_PATH=/opt/flash-mdm/data/deploy/github-known_hosts
export FLASH_AUTO_DEPLOY=true
export FLASH_AUTO_DEPLOY_WEBHOOK_BIND_ADDRESS=10.88.0.45
export FLASH_AUTO_DEPLOY_REPO_REF=main
export FLASH_AUTO_DEPLOY_WEBHOOK_REPOSITORY=owner/flash_mdm
export FLASH_AUTO_DEPLOY_WEBHOOK_SECRET='a-long-random-webhook-secret'
bash install.sh
```

For first-time provisioning, instead of supplying an existing path, provide the deploy key encoded as a single-line base64 value. The installer writes it with mode `0600` and ownership of the deployment user:

```bash
export FLASH_REPO_SSH_PRIVATE_KEY_B64="$(base64 -w0 repository-deploy.key)"
export FLASH_REPO_SSH_KNOWN_HOSTS_B64="$(base64 -w0 github-known_hosts)"
```

For SSH repositories, the known-hosts file is mandatory. Obtain the host key from an authoritative provider channel and review it before provisioning it; do not use `StrictHostKeyChecking=accept-new` for unattended deployment.

The listener verifies GitHub's `X-Hub-Signature-256` HMAC, accepts only `push` events for the configured repository and branch, and starts a SHA-addressed one-shot release service. It returns `202` only after the privileged launcher has successfully handed the release to systemd; a failed handoff returns `503` so GitHub retries the delivery. The release service verifies that the signed `after` SHA is still the configured remote branch head before calling the installer. It exits without a restart when that SHA is already active. Use the default loopback bind for single-container Caddy. When Caddy is in a separate LXD container, bind only to the Flash container's private address so that Caddy can reach it.

## Production validation gate

The webhook proves that a push came from GitHub and deploys the exact branch-head SHA, but it does not inspect the GitHub Actions result. A production repository that deploys pushes to `main` must therefore protect `main` in GitHub with all of these controls:

- require changes through a pull request;
- require the `validate` status check from `.github/workflows/validate.yml`;
- require branches to be up to date before merging (strict status checks);
- apply the protection to repository administrators; and
- disable force pushes and branch deletion.

No approving review count is required by this deployment gate; teams can add a review requirement as a separate governance control. Do not configure a bypass actor for the deployment identity. With this protection in place, Actions validates the pull-request merge candidate against the current `main` branch before GitHub permits the merge, and the existing signed push webhook then deploys the resulting merge commit. This Option A gate validates the content entering `main` and prevents unvalidated direct pushes. It does not make the separate post-merge `push` workflow a prerequisite for deployment or prove that the exact merge SHA's push run has already completed.

Verify the live repository setting rather than relying on documentation alone:

```bash
gh api repos/OWNER/REPOSITORY/branches/main/protection \
  --jq '{required_status_checks, enforce_admins, required_pull_request_reviews, allow_force_pushes, allow_deletions}'
```

Test the gate with a documentation-only pull request: confirm `validate` is required and passes for the merge candidate, merge the pull request, then confirm the webhook deploys the merge SHA, the independently triggered main-branch Validate run passes, and `/api/health` reports the same version. A direct push rejection can also be tested from a disposable branch clone, but never rewrite production history to exercise the control.

The normal recovery path is another validated pull request that reverts the faulty change. Runtime rollback remains the host's LXD snapshot procedure. If GitHub Actions itself is unavailable during an urgent incident, a repository administrator may temporarily change branch protection as a recorded break-glass action, perform only the minimum recovery, and immediately restore and re-verify the controls; the webhook's signature, exact-SHA, readiness, and rollback checks remain mandatory.

For an external Caddy deployment, add this route before the catch-all Flash proxy in the public Caddy configuration and reload it as the Caddy administrator:

```caddyfile
handle /api/deploy/webhook {
    reverse_proxy <flash-container-private-address>:3101
}
```

`127.0.0.1` is correct only when Caddy and Flash run in the same host namespace. With separate LXD containers, use Flash's private container address. The installer adds the same route automatically when it owns Caddy. Then configure a GitHub repository webhook with content type `application/json`, the same secret, and `https://your-domain.example/api/deploy/webhook`.

## Controls

| Variable | Default | Purpose |
| --- | --- | --- |
| `FLASH_AUTO_DEPLOY` | unset | Set `true` to enable the webhook listener; set `false` to remove it. |
| `FLASH_AUTO_DEPLOY_REPO_URL` | `FLASH_REPO_URL` | Repository to deploy. |
| `FLASH_AUTO_DEPLOY_REPO_REF` | `main` | Branch to deploy. |
| `FLASH_AUTO_DEPLOY_REPO_SSH_KEY_PATH` | `FLASH_REPO_SSH_KEY_PATH` | Path to the read-only repository deploy key. |
| `FLASH_AUTO_DEPLOY_REPO_SSH_KNOWN_HOSTS_PATH` | `FLASH_REPO_SSH_KNOWN_HOSTS_PATH` | Verified SSH known-hosts file for the deploy host. |
| `FLASH_REPO_SSH_PRIVATE_KEY_B64` or `FLASH_AUTO_DEPLOY_REPO_SSH_PRIVATE_KEY_B64` | unset | Base64 deploy-key material provisioned by the installer. |
| `FLASH_REPO_SSH_KNOWN_HOSTS_B64` or `FLASH_AUTO_DEPLOY_REPO_SSH_KNOWN_HOSTS_B64` | unset | Base64 verified known-hosts material provisioned by the installer. |
| `FLASH_AUTO_DEPLOY_WEBHOOK_REPOSITORY` | required | GitHub `owner/repository` expected in the payload. |
| `FLASH_AUTO_DEPLOY_WEBHOOK_SECRET` | required | GitHub webhook HMAC secret. |
| `FLASH_AUTO_DEPLOY_WEBHOOK_PORT` | `3101` | Local listener port. |
| `FLASH_AUTO_DEPLOY_WEBHOOK_BIND_ADDRESS` | `127.0.0.1` | Listener address; required to be a non-loopback private address with `FLASH_EXTERNAL_CADDY=true`. |
| `FLASH_AUTO_DEPLOY_USER` | installer user | Unprivileged account used for Git and installation. |

Inspect the listener and release logs with:

```bash
journalctl -u flashmdm-auto-deploy-webhook.service -f
journalctl -u 'flashmdm-auto-deploy@*.service' -f
```

The webhook listener runs as the configured deployment user and has no interactive shell. Its only privileged action is a root-owned launcher that accepts exactly one 40-character lowercase SHA before starting the corresponding release unit. The root launcher, release helper, and active `current` symlink are root-owned outside the writable release staging directory. The release unit runs the existing installer in its controlled root mode while preserving the configured unprivileged owner for the runtime services and cron. Treat write access to the configured repository as production-root-equivalent access.

After a candidate release passes readiness, migrations, worker startup, and Caddy validation, the installer removes all inactive release directories. A failed candidate retains the previous release until rollback completes. Operational rollback after a successful deployment is provided by the host's LXD snapshots rather than by accumulating complete application releases inside the container.
