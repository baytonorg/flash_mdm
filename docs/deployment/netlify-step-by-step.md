# Netlify deployment (step-by-step)

This guide is written for operators deploying Flash MDM in a multi-tenant configuration.

> Assumption: you are comfortable managing Netlify + Postgres + Google Cloud.

## 0) Choose your environment strategy

Minimum recommended environments:

- **staging** (production-like) and **prod**

Strongly recommended:

- separate Postgres per environment
- separate AMAPI project/credentials per environment
- Stripe test vs live separation

## 1) Provision Postgres

- Provision a Postgres instance.
- Ensure TLS is supported in production (Flash MDM uses TLS when `NODE_ENV !== development`).
- Plan backups/snapshots and test restores.

See:

- [Database](./database.md)
- [Migrations & rollbacks](./migrations-and-rollbacks.md)

## 2) Create the Netlify site

- Create a new Netlify site from your Git repo.
- Ensure Netlify Functions are enabled.

Key file:

- `netlify.toml` (redirects, headers, and runtime config)

## 3) Configure environment variables

Start from:

- `.env.example`
- [Environment variables reference](../reference/environment-variables.md)

Minimum required for a functional deployment:

- `DATABASE_URL` (or `NETLIFY_DATABASE_URL`)
- `ENCRYPTION_MASTER_KEY`
- `INTERNAL_FUNCTION_SECRET`
- `MIGRATION_SECRET`

Then add features:

- Email: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- Pub/Sub auth (recommended): `PUBSUB_SHARED_SECRET`
- Billing/licensing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, plus licensing toggles

### Encryption key note

`ENCRYPTION_MASTER_KEY` is required; backend crypto will throw at runtime if it is missing.

## 4) Migrations

Flash MDM includes a built-in migration runner exposed at `/api/migrate`. It applies SQL migrations in order and tracks which have already run, so it is safe to call repeatedly.

To run migrations after deploy:

```bash
curl https://<your-site>/api/migrate \
  -H "x-migration-secret: <MIGRATION_SECRET value>"
```

The endpoint requires `MIGRATION_SECRET` to be set as an environment variable; it will return `500` if the variable is absent and `401` if the header does not match.

> Rollback stance: forward-fix with new migrations; use snapshots for disaster recovery.

See: [Migrations & rollbacks](./migrations-and-rollbacks.md)

## 5) Bootstrap superadmin access

Flash MDM includes bootstrap mechanisms intended to make initial setup possible.

- `BOOTSTRAP_SECRET` exists for initial registration/bootstrap flows.

Operator guidance:

- set bootstrap values temporarily
- perform initial admin creation
- remove bootstrap settings afterwards

## 6) Configure AMAPI (Android Management API)

In Google Cloud:

1) Create a GCP project.
2) Enable **Android Management API**.
3) Create a service account with the required role.

In Flash MDM:

- upload service account JSON via Settings
- credentials are encrypted and stored in Postgres

## 7) Configure Pub/Sub notifications (recommended)

If using AMAPI notifications:

1) Create a Pub/Sub topic.
2) Create a push subscription to:

- `https://<your-site>/api/pubsub/webhook`

3) Add an auth header (Bearer) using `PUBSUB_SHARED_SECRET`.

## 8) (Optional) Configure Stripe

- Configure webhook endpoint: `https://<your-site>/api/stripe/webhook`
- Ensure webhook verification secrets are set.
- Confirm idempotency behavior with a staging environment.

## 9) Smoke tests

After deploy:

- confirm login/register flows
- create a workspace/environment
- bind to AMAPI enterprise
- generate enrollment token/QR
- verify device import/sync
- verify audit log entries appear

## 10) Observability

- Ensure you can access Netlify function logs.
- Ensure Superadmin log views are restricted.
- Set alerting on 5xx spikes, webhook failures, job backlogs, and DB errors.

See:

- [Monitoring & logs](../operations/monitoring-and-logs.md)
