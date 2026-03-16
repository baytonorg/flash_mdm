# Environment variables (curated)

This page is a curated view of environment variables used by Flash MDM.

Canonical encryption key: `ENCRYPTION_MASTER_KEY`.

> Detailed inventory sources:
> - `docs/reference/env-inventory.json`
> - `docs/reference/env-references.json`

## AMAPI live test helpers (dev-only)

- `AMAPI_LIVE_BEARER_TOKEN` (secret)
  - refs: netlify/functions/_lib/__tests__/policy-update-mask.live.test.ts:5
- `AMAPI_LIVE_EXPECT_CLEARED_TOP_LEVEL_KEY` (secret)
  - refs: netlify/functions/_lib/__tests__/policy-update-mask.live.test.ts:9
- `AMAPI_LIVE_POLICY_BASELINE_JSON` (non-secret)
  - refs: netlify/functions/_lib/__tests__/policy-update-mask.live.test.ts:7
- `AMAPI_LIVE_POLICY_NAME` (non-secret)
  - refs: netlify/functions/_lib/__tests__/policy-update-mask.live.test.ts:6
- `AMAPI_LIVE_POLICY_PATCH_JSON` (non-secret)
  - refs: netlify/functions/_lib/__tests__/policy-update-mask.live.test.ts:8
- `AMAPI_LIVE_POLICY_TEST_ENABLE` (non-secret)
  - refs: netlify/functions/_lib/__tests__/policy-update-mask.live.test.ts:4

## Data retention

- `AUDIT_LOG_RETENTION_DAYS` (non-secret)
  - refs: netlify/functions/__tests__/cleanup-scheduled.test.ts:40, netlify/functions/cleanup-scheduled.ts:14
- `DEVICE_LOCATION_RETENTION_DAYS` (non-secret)
  - refs: netlify/functions/__tests__/cleanup-scheduled.test.ts:41, netlify/functions/cleanup-scheduled.ts:15
- `DEVICE_STATUS_REPORT_RETENTION_DAYS` (non-secret)
  - refs: netlify/functions/__tests__/cleanup-scheduled.test.ts:42, netlify/functions/cleanup-scheduled.ts:16
- `SOFT_DELETED_DEVICE_RETENTION_DAYS` (non-secret)
  - refs: netlify/functions/__tests__/cleanup-scheduled.test.ts:43, netlify/functions/cleanup-scheduled.ts:17

## Security / secrets

- `BOOTSTRAP_SECRET` (secret)
  - refs: netlify/functions/auth-register.ts:149
- `ENCRYPTION_MASTER_KEY` (secret)
  - refs: netlify/functions/_lib/__tests__/crypto.test.ts:8, netlify/functions/_lib/crypto.ts:8
- `INTERNAL_FUNCTION_SECRET` (secret)
  - refs: netlify/functions/_lib/__tests__/internal-auth.test.ts:12, netlify/functions/_lib/__tests__/internal-auth.test.ts:14, netlify/functions/_lib/__tests__/internal-auth.test.ts:30 (+13 more)
- `MIGRATION_SECRET` (secret)
  - refs: netlify/functions/__tests__/superadmin-actions.test.ts:155, netlify/functions/migrate.ts:1544, netlify/functions/superadmin-actions.ts:189
- `PUBSUB_SHARED_SECRET` (secret)
  - refs: netlify/functions/pubsub-webhook.ts:26
- `SECRETS_SCAN_OMIT_KEYS` (secret)

## Core runtime

- `DATABASE_URL` (secret — contains credentials)
  - refs: netlify/functions/_lib/db.ts:12, netlify/functions/migrate.ts:1564
- `DEPLOY_PRIME_URL` (non-secret)
  - refs: netlify/functions/auth-magic-link-start.ts:58, netlify/functions/auth-magic-link-verify.ts:103, netlify/functions/auth-magic-link-verify.ts:61 (+5 more)
- `NETLIFY_DATABASE_URL` (secret — contains credentials)
  - refs: netlify/functions/_lib/db.ts:12, netlify/functions/migrate.ts:1564
- `NETLIFY_DEV` (non-secret)
  - refs: netlify/functions/_lib/__tests__/internal-auth.test.ts:22, netlify/functions/_lib/__tests__/internal-auth.test.ts:24, netlify/functions/_lib/__tests__/internal-auth.test.ts:48 (+2 more)
- `NODE_ENV` (non-secret)
  - refs: netlify/functions/_lib/__tests__/internal-auth.test.ts:17, netlify/functions/_lib/__tests__/internal-auth.test.ts:19, netlify/functions/_lib/__tests__/internal-auth.test.ts:47 (+6 more)
- `URL` (non-secret)
  - refs: netlify/functions/__tests__/auth-password-reset.test.ts:116, netlify/functions/__tests__/auth-password-reset.test.ts:117, netlify/functions/__tests__/auth-password-reset.test.ts:136 (+10 more)

## Licensing

- `LICENSING_DRY_RUN` (non-secret)
  - refs: netlify/functions/_lib/licensing.ts:82
- `LICENSING_ENFORCEMENT_ENABLED` (non-secret)
  - refs: netlify/functions/_lib/__tests__/licensing.test.ts:127, netlify/functions/_lib/__tests__/licensing.test.ts:128, netlify/functions/_lib/__tests__/licensing.test.ts:134 (+18 more)

## Email (Resend)

- `RESEND_API_KEY` (secret)
  - refs: netlify/functions/_lib/resend.ts:14
- `RESEND_FROM_EMAIL` (non-secret)
  - refs: netlify/functions/_lib/resend.ts:17

## Billing (Stripe)

- `STRIPE_SECRET_KEY` (secret)
  - refs: netlify/functions/__tests__/api-route-hardening.test.ts:301, netlify/functions/__tests__/api-route-hardening.test.ts:302, netlify/functions/__tests__/api-route-hardening.test.ts:320 (+19 more)
- `STRIPE_WEBHOOK_SECRET` (secret)
  - refs: netlify/functions/__tests__/stripe-webhook.test.ts:74, netlify/functions/stripe-webhook.ts:68

## Frontend (build-time)

- `VITE_GOOGLE_MAPS_API_KEY` (secret)

