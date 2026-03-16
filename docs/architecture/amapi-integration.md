# AMAPI integration (Android Management API)

This page explains how Flash MDM integrates with the **Android Management API (AMAPI)**, including binding, enrollment, sync, and operational constraints.

## 1) Core concepts

- **Environment ↔ AMAPI enterprise**: environments represent a logical slice of a workspace and are typically bound to an AMAPI enterprise.
- **Policies**: Flash MDM builds and patches AMAPI policies based on local components, assignments, and overrides.
- **Commands**: destructive and non-destructive device commands are dispatched via AMAPI.

## 2) Authentication

Flash MDM uses a Google Cloud **service account**.

- Operators create the service account in GCP.
- Administrators upload the service account JSON in the Flash MDM UI.
- Credentials are encrypted at rest (AES-256-GCM) and stored in Postgres.

Relevant code/search starting points:

- `README.md` (GCP service account section)
- `netlify/functions/_lib/amapi.ts`

## 3) Binding an environment

Environment binding code is handled in:

- `netlify/functions/environment-bind.ts`

This flow (high level):

- Create or delete an AMAPI enterprise.
- Optionally configure notifications (Pub/Sub topic).
- Push a default “safety net” policy.
- Push/patch all policies after binding.

## 4) Enrollment

Enrollment token creation is handled in the enrollment functions.

- Enrollment tokens are short-lived and may be one-time use.
- Devices enroll using AMAPI mechanisms; Flash MDM records local device state in Postgres.

Related code:

- `netlify/functions/enrollment-create.ts`
- `netlify/functions/enrollment-crud.ts`
- `netlify/functions/signin-enroll.ts` (sign-in based flows)

## 5) Sync and reconciliation

Flash MDM is designed for eventual consistency.

Mechanisms:

- Pub/Sub push notifications → webhook ingestion
- Background processors consuming a job queue
- Scheduled reconciliation jobs

Related code:

- `netlify/functions/pubsub-webhook.ts`
- `netlify/functions/sync-process-background.ts`
- `netlify/functions/sync-reconcile-scheduled.ts`

## 6) Rate limiting

AMAPI is rate-limited and can return transient failures.

As-built notes:

- Code contains explicit comments about AMAPI rate limits and conservative batching.
- AMAPI wrapper retries specific failure cases.

Related code:

- `netlify/functions/_lib/amapi.ts`
- `netlify/functions/deployment-jobs.ts` (batching comments)

## 7) Failure modes (operator + engineer checklist)

Common failure modes to document/monitor:

- AMAPI 429/503 (rate limiting / transient backend issues)
- Pub/Sub delivery failures or auth misconfiguration
- Background processor backlog growth
- Policy patch failures causing partial sync

Observability:

- Netlify function logs
- Superadmin-exposed server logs
- Audit log for sensitive actions

## 8) Security considerations

- Pub/Sub webhook should be authenticated (`PUBSUB_SHARED_SECRET`).
- Inputs that trigger outbound requests must be SSRF-hardened.
- Device commands must be RBAC restricted (especially destructive commands).

See the security documentation in `docs/security/` for details on RBAC enforcement.
