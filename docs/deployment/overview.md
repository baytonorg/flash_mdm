# Deployment overview

Flash MDM is designed to be hosted by an operator.

> In Jason’s words: “whoever hosts it is the god”.

That means: security posture, compliance posture, monitoring, backups, and operational discipline are primarily **operator responsibilities**.

## 1) Supported deployment shapes

Every deployment needs the React frontend, API/background handlers, PostgreSQL,
blob storage, scheduled jobs, and protected environment configuration. Flash MDM
supports two hosting shapes for those components:

### Netlify

- A **Netlify site** hosts the static React (Vite) frontend (`dist/`), API
  functions, and background/scheduled functions.
- PostgreSQL is reachable from the Netlify runtime.
- Netlify Blobs provides object storage.
- Netlify environment variables are the protected configuration route.

### VPS

- The versioned release beneath `/opt/flash-mdm/current` hosts the frontend and
  Node API service.
- `flashmdm.service` serves the application and `flashmdm-worker.service` drains
  the durable job queue.
- PostgreSQL and the configured absolute `FLASH_BLOB_DIR` provide durable state.
- Cron invokes the five scheduled handlers through `run-vps-scheduled.sh`.
- Caddy terminates TLS. The optional signed GitHub webhook can activate an exact
  branch-head release after the repository's required validation gate passes.
- `/opt/flash-mdm/.env` is installed mode `0600` for the service account and is
  the protected application configuration route. Auto-deploy configuration is
  separate under `/etc/flash-mdm/`.

Both shapes use environment variables defining:

- DB connection
- encryption/auth secrets
- AMAPI configuration
- optional Stripe + email configuration

Do not assume a deployment's hosting shape from an old runbook. Confirm it from
`GET /api/health` (`runtime` and `version`) and the live platform configuration.

## 2) Environments

Flash MDM commonly runs as:

- **dev** (local / preview)
- **staging**
- **prod**

These should be separated with:

- different databases
- different AMAPI credentials/projects
- Stripe test vs live separation

See: [Environments](./environments.md)

## 3) Rollback model

- **Netlify app rollback:** use Netlify deploy history.
- **VPS application recovery:** submit a validated reverting change for normal
  recovery. Use the host's LXD snapshot procedure when runtime rollback is
  required; inactive application release directories are not retained as the
  durable rollback mechanism.
- **DB rollback:** typically use a forward migration (“revert with a new
  migration”). Migrations are forward-only and must be preceded by a verified
  database-and-blob recovery point.
- **DB disaster recovery:** restore the matching operator-managed database and
  blob recovery set. Recovery is not granular to individual writes.

See: [Migrations & rollbacks](./migrations-and-rollbacks.md)

## Self-hosted database

- [LXD Postgres for Netlify](./lxd-postgres-netlify.md) covers moving the database from Neon/Netlify DB to a local LXD container while keeping the application on Netlify.
- The same guide documents the fully VPS-hosted LXD shape, its network boundary,
  systemd services, cron, validation, and cutover checks.

## Step-by-step

- [Netlify deployment (step-by-step)](./netlify-step-by-step.md)
- [VPS installer and manual deployment](../../README.md#vps-deployment)
- [Signed VPS webhook deployment](./vps-auto-deploy.md)

## Bootstrap & access

- [Bootstrap and initial access](./bootstrap-and-access.md)
