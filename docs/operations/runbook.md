# Operations runbook

This runbook assumes you operate Flash MDM as a hosted service.

## Day-0: provisioning checklist

1) **Database**
   - Provision Postgres
   - Enable required extensions (see migrations)
   - Set up automated backups/snapshots

2) **Netlify site**
   - Configure build and deploy
   - Configure redirects/headers via `netlify.toml`

3) **Required secrets & env vars**
   - `DATABASE_URL` (or `NETLIFY_DATABASE_URL` if using Netlify DB — provided automatically)
   - `ENCRYPTION_MASTER_KEY` — 32-byte hex key for AES-256-GCM at-rest encryption
   - `INTERNAL_FUNCTION_SECRET` — shared secret for internal function-to-function calls
   - `MIGRATION_SECRET` — required to invoke the `/api/migrate` endpoint

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

- Review Netlify function logs and in-app audit logs
- Monitor scheduled function health (cleanup, reconcile, geofence, workflow cron, licensing)
- Monitor the job queue for stuck or failed jobs
- Rotate secrets on a schedule
- Periodically test restore from backup
- Practice rollback (Netlify deploy history) and forward-fix migrations

## Day-N: incident handling

- Use audit logs to identify actor, action, and resource scope
- Use Netlify function logs to correlate errors and time windows
- Contain by revoking API keys, disabling users, or rolling back a deploy if needed

See:
- [Monitoring & logs](./monitoring-and-logs.md)
- [Incident response](./incident-response.md)
- [Backup & restore](./backup-and-restore.md)
