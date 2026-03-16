# Environment variables

Flash MDM is configured primarily via environment variables (dev/staging/prod).

**Canonical note:** the encryption env var is `ENCRYPTION_MASTER_KEY` (see `.env.example` + backend crypto module).

## Inventory

This table is generated from `.env.example`, `netlify.toml`, and `process.env.*` usage in the codebase.

| Key | Required? | Classification | Description (.env.example) | Seen in | Code refs (sample) |
|---|---|---|---|---|---|
| `AMAPI_LIVE_BEARER_TOKEN` | dev-only | secret |  | code | netlify/functions/_lib/__tests__/policy-update-mask.live.test.ts:5 |
| `AMAPI_LIVE_EXPECT_CLEARED_TOP_LEVEL_KEY` | dev-only | secret |  | code | netlify/functions/_lib/__tests__/policy-update-mask.live.test.ts:9 |
| `AMAPI_LIVE_POLICY_BASELINE_JSON` | dev-only | non-secret |  | code | netlify/functions/_lib/__tests__/policy-update-mask.live.test.ts:7 |
| `AMAPI_LIVE_POLICY_NAME` | dev-only | non-secret |  | code | netlify/functions/_lib/__tests__/policy-update-mask.live.test.ts:6 |
| `AMAPI_LIVE_POLICY_PATCH_JSON` | dev-only | non-secret |  | code | netlify/functions/_lib/__tests__/policy-update-mask.live.test.ts:8 |
| `AMAPI_LIVE_POLICY_TEST_ENABLE` | dev-only | non-secret |  | code | netlify/functions/_lib/__tests__/policy-update-mask.live.test.ts:4 |
| `AUDIT_LOG_RETENTION_DAYS` | optional (has defaults) | non-secret |  | code | netlify/functions/__tests__/cleanup-scheduled.test.ts:40; netlify/functions/cleanup-scheduled.ts:14 |
| `BOOTSTRAP_SECRET` | optional (bootstrap only) | secret |  | code | netlify/functions/auth-register.ts:149 |
| `DATABASE_URL` | required | secret | --- Database (Netlify DB / Postgres) ---------------------------------------- Automatically provided by Netlify DB. Only needed for local development. Contains credentials — treat as a secret. | .env.example, code | netlify/functions/_lib/db.ts:12; netlify/functions/migrate.ts:1564 |
| `DEPLOY_PRIME_URL` | provided by platform/dev | non-secret |  | code | netlify/functions/auth-magic-link-start.ts:58; netlify/functions/auth-magic-link-verify.ts:103; netlify/functions/auth-magic-link-verify.ts:61; netlify/functions/auth-password-reset-start.ts:61; netlify/functions/auth-register.ts:475; netlify/functions/environment-bind.ts:442 (+2 more) |
| `DEVICE_LOCATION_RETENTION_DAYS` | optional (has defaults) | non-secret |  | code | netlify/functions/__tests__/cleanup-scheduled.test.ts:41; netlify/functions/cleanup-scheduled.ts:15 |
| `DEVICE_STATUS_REPORT_RETENTION_DAYS` | optional (has defaults) | non-secret |  | code | netlify/functions/__tests__/cleanup-scheduled.test.ts:42; netlify/functions/cleanup-scheduled.ts:16 |
| `ENCRYPTION_MASTER_KEY` | required | secret | --- Encryption -------------------------------------------------------------- 32-byte hex key for AES-256-GCM encryption of secrets at rest. Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | .env.example, code | netlify/functions/_lib/__tests__/crypto.test.ts:8; netlify/functions/_lib/crypto.ts:8 |
| `INTERNAL_FUNCTION_SECRET` | required | secret | --- Internal Licensing Enforcement ------------------------------------------- Shared secret for invoking internal-only functions (set in all non-local envs). | .env.example, code | netlify/functions/_lib/__tests__/internal-auth.test.ts:12; netlify/functions/_lib/__tests__/internal-auth.test.ts:14; netlify/functions/_lib/__tests__/internal-auth.test.ts:30; netlify/functions/_lib/__tests__/internal-auth.test.ts:38; netlify/functions/_lib/__tests__/internal-auth.test.ts:46; netlify/functions/_lib/__tests__/internal-auth.test.ts:6 (+10 more) |
| `LICENSING_DRY_RUN` | required if licensing enabled | non-secret | Dry-run mode for reconcile/escalation. Recommended true until rollout is complete. | .env.example, code | netlify/functions/_lib/licensing.ts:82 |
| `LICENSING_ENFORCEMENT_ENABLED` | required if licensing enabled | non-secret | Master kill-switch for enforcement actions (DISABLE/WIPE). Keep false until validated. | .env.example, code | netlify/functions/_lib/__tests__/licensing.test.ts:127; netlify/functions/_lib/__tests__/licensing.test.ts:128; netlify/functions/_lib/__tests__/licensing.test.ts:134; netlify/functions/_lib/__tests__/licensing.test.ts:136; netlify/functions/_lib/__tests__/licensing.test.ts:141; netlify/functions/_lib/__tests__/licensing.test.ts:142 (+15 more) |
| `MIGRATION_SECRET` | required to use /api/migrate endpoint | secret |  | code | netlify/functions/__tests__/superadmin-actions.test.ts:155; netlify/functions/migrate.ts:1544; netlify/functions/superadmin-actions.ts:189 |
| `NETLIFY_DATABASE_URL` | provided by platform/dev | secret |  | code | netlify/functions/_lib/db.ts:12; netlify/functions/migrate.ts:1564 |
| `NETLIFY_DEV` | provided by platform/dev | non-secret |  | code | netlify/functions/_lib/__tests__/internal-auth.test.ts:22; netlify/functions/_lib/__tests__/internal-auth.test.ts:24; netlify/functions/_lib/__tests__/internal-auth.test.ts:48; netlify/functions/_lib/__tests__/internal-auth.test.ts:8; netlify/functions/_lib/internal-auth.ts:35 |
| `NODE_ENV` | provided by platform/dev | non-secret |  | code | netlify/functions/_lib/__tests__/internal-auth.test.ts:17; netlify/functions/_lib/__tests__/internal-auth.test.ts:19; netlify/functions/_lib/__tests__/internal-auth.test.ts:47; netlify/functions/_lib/__tests__/internal-auth.test.ts:7; netlify/functions/_lib/auth.ts:396; netlify/functions/_lib/db.ts:17 (+3 more) |
| `PUBSUB_SHARED_SECRET` | recommended (required if Pub/Sub webhook auth enabled) | secret | --- Google Cloud (PubSub) --------------------------------------------------- Shared secret for authenticating AMAPI PubSub push notifications. Choose any strong random string; must match the PubSub subscription config. | .env.example, code | netlify/functions/pubsub-webhook.ts:26 |
| `RESEND_API_KEY` | required if email enabled | secret | --- Resend (transactional email) -------------------------------------------- Sign up at https://resend.com and create an API key. | .env.example, code | netlify/functions/_lib/resend.ts:14 |
| `RESEND_FROM_EMAIL` | optional (defaults exist) | non-secret |  | code | netlify/functions/_lib/resend.ts:17 |
| `SECRETS_SCAN_OMIT_KEYS` | optional (hardening/scanner config) | secret |  | netlify.toml |  |
| `SOFT_DELETED_DEVICE_RETENTION_DAYS` | optional (has defaults) | non-secret |  | code | netlify/functions/__tests__/cleanup-scheduled.test.ts:43; netlify/functions/cleanup-scheduled.ts:17 |
| `STRIPE_SECRET_KEY` | required if Stripe/billing enabled | secret | --- Stripe (licensing & billing) -------------------------------------------- Dashboard: https://dashboard.stripe.com/apikeys | .env.example, code | netlify/functions/__tests__/api-route-hardening.test.ts:301; netlify/functions/__tests__/api-route-hardening.test.ts:302; netlify/functions/__tests__/api-route-hardening.test.ts:320; netlify/functions/__tests__/api-route-hardening.test.ts:324; netlify/functions/__tests__/api-route-hardening.test.ts:325; netlify/functions/__tests__/api-route-hardening.test.ts:352 (+16 more) |
| `STRIPE_WEBHOOK_SECRET` | required if Stripe/billing enabled | secret | Webhook signing secret from Stripe webhook endpoint config | .env.example, code | netlify/functions/__tests__/stripe-webhook.test.ts:74; netlify/functions/stripe-webhook.ts:68 |
| `URL` | provided by platform/dev | non-secret |  | code | netlify/functions/__tests__/auth-password-reset.test.ts:116; netlify/functions/__tests__/auth-password-reset.test.ts:117; netlify/functions/__tests__/auth-password-reset.test.ts:136; netlify/functions/__tests__/auth-password-reset.test.ts:137; netlify/functions/app-web-token.ts:64; netlify/functions/auth-magic-link-start.ts:58 (+7 more) |
| `VITE_GOOGLE_MAPS_API_KEY` | required for feature | secret | --- Google Maps (frontend, geofencing) -------------------------------------- Must have Maps JavaScript API enabled. Restrict to your domain in the GCP Console. | .env.example |  |

## Files

- Inventory JSON: `docs/reference/env-inventory.json`
- Reference map: `docs/reference/env-references.json`

## Retention note

`cleanup-scheduled` also clears stale pending TOTP setup data after one day. This threshold is currently fixed in code and has no environment variable override.
