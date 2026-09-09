# Operations runbook

This runbook assumes you operate Flash MDM as a hosted service.

## Day-0: provisioning checklist

1) **Database**
   - Provision Postgres
   - Enable required extensions (see migrations)
   - Set up automated backups/snapshots

2) **Hosting runtime**
   - Netlify: configure build/deploy and redirects/headers via `netlify.toml`.
   - VPS: use the versioned installer path, confirm Caddy TLS/routing,
     `flashmdm`, `flashmdm-worker`, PostgreSQL, and cron are active, then run
     `scripts/validate-vps-flash.sh` from a trusted operator workstation.

3) **Required secrets & env vars**
   - `DATABASE_URL` (or `NETLIFY_DATABASE_URL` if using Netlify DB — provided automatically)
   - `ENCRYPTION_MASTER_KEY` — 32-byte hex key for AES-256-GCM at-rest encryption
   - `INTERNAL_FUNCTION_SECRET` — shared secret for internal function-to-function calls
   - `MIGRATION_SECRET` — required to invoke the `/api/migrate` endpoint
   - Netlify: store these in protected site environment variables.
   - VPS: store application configuration in `/opt/flash-mdm/.env`, mode `0600`,
     owned by the service account. Keep deploy keys and auto-deploy listener
     configuration on their documented separate protected paths.

4) **Optional env vars (configure as needed)**
   - `RESEND_API_KEY` + `RESEND_FROM_EMAIL` — transactional email
   - `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` — billing
   - `PUBSUB_SHARED_SECRET` — authenticates AMAPI Pub/Sub push notifications
   - `VITE_GOOGLE_MAPS_API_KEY` — required for the geofencing map UI
   - `LICENSING_ENFORCEMENT_ENABLED` + `LICENSING_DRY_RUN` — licensing enforcement; keep dry-run enabled until validated

5) **AMAPI**
   - Create a GCP project and enable the Android Management API
   - Create a service account with the required role
   - Upload credentials in the Flash MDM UI (stored encrypted)

## Day-2: ongoing operations

- Review the platform-specific runtime logs and in-app audit logs: Netlify
  function logs, or `journalctl -u flashmdm`, `journalctl -u flashmdm-worker`,
  the `flashmdm-cron` journal tag, and auto-deploy units on VPS.
- Monitor scheduled function health (cleanup, reconcile, geofence, workflow cron, licensing)
- Monitor the job queue for stuck, dead, or `delivery_uncertain` jobs. A delivery-
  uncertain AMAPI command is terminal and must not be replayed until the operator
  checks device operations and audit history.
- Rotate secrets on a schedule
- Periodically test restore from backup
- Practice the platform rollback route (Netlify deploy history or VPS LXD
  snapshot/reverting release) and forward-fix migrations.

## Day-N: incident handling

- Use audit logs to identify actor, action, and resource scope
- Use Netlify function logs or the VPS journals to correlate errors and time windows.
- For ambiguous AMAPI command delivery, do not blindly resend destructive or
  non-idempotent commands. Check the operation list, device state, workflow
  execution history, privileged audit event, and queue terminal state first.
- Use the platform-specific rollback route when a deployment caused the incident.
- Credential or key revocation/rotation is a separate operator decision; follow
  the incident plan and credential-lifecycle authority for the deployment.

See:
- [Monitoring & logs](./monitoring-and-logs.md)
- [Incident response](./incident-response.md)
- [Backup & restore](./backup-and-restore.md)
- [Encryption master-key rotation](./encryption-key-rotation.md)
