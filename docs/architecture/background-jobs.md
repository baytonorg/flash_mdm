# Background jobs & scheduled functions

Flash MDM uses asynchronous processing for:

- AMAPI sync and reconciliation
- workflow evaluation
- geofence checks
- licensing/billing enforcement
- cleanup/retention

This is necessary because serverless HTTP handlers should be fast and because AMAPI and other dependencies can be slow or rate-limited.

## 1) Building blocks

### Job queue

Jobs are stored in Postgres (e.g. `job_queue`) and processed in batches.

Common design patterns:

- `FOR UPDATE SKIP LOCKED` when dequeuing from `job_queue` (used in `sync-process-background`)
- explicit status transitions (`pending` → `locked` → `completed`/`dead`, with
  terminal `delivery_uncertain` for ambiguous non-idempotent AMAPI delivery)
- idempotency/deduplication for externally-triggered events (e.g. Pub/Sub, Stripe)

### Scheduled functions

Scheduled functions (cron) execute on a schedule and typically:

- enqueue work
- process bounded batches
- perform retention cleanup

### Internal-only triggers

Some background endpoints should only be callable internally.

As-built, Flash MDM uses a shared secret (`INTERNAL_FUNCTION_SECRET`) to authenticate internal callers.

## 2) Key background/scheduled jobs (as-built)

This list is intentionally high-level; details live in code and will be expanded with a per-job runbook.

- `sync-process-background`
  - Process Pub/Sub ingestion jobs and apply state updates.

- `sync-reconcile-scheduled`
  - Full state reconciliation against AMAPI.

- `workflow-evaluate-background`
  - Evaluate workflow triggers for queued events.

- `workflow-cron-scheduled`
  - Fire time-based triggers.

- `geofence-check-scheduled`
  - Check device locations against configured geofences.

- `cleanup-scheduled`
  - Expire sessions/tokens and enforce data retention windows.

- `deployment-jobs-background`
  - Process queued policy deployment jobs (pushes compiled policies to AMAPI devices).

- `licensing-reconcile-scheduled` (when licensing is enabled)
  - Evaluate overage cases and enforce configured phases.

## 3) Operational concerns

- **Concurrency control:** use advisory locks for global reconcile tasks.
- **Timeouts:** scheduled functions must batch work to avoid runtime timeouts.
- **Safety:** destructive actions should be guarded by feature flags and dry-run modes.
- **Database outages:** queue and deployment drains return HTTP 503 with
  `Retry-After` and `X-Flash-Degraded: database` when PostgreSQL is unavailable.
  The VPS worker applies capped exponential backoff with jitter (30 seconds by
  default) and resets to its normal poll interval immediately after recovery.
- **VPS logging:** idle polls stay silent. A database outage emits one structured
  `event=database_unavailable` warning per affected drain, followed by one
  `event=database_recovered` message with the degraded-poll count. Batch/completion
  logs remain available whenever work is processed.
- **VPS shutdown:** `SIGTERM` stops new polls, lets active handlers finish, and
  interrupts any normal or database-backoff sleep, then closes the shared
  PostgreSQL pool so planned releases do not wait for idle database handles.
- **Lease safety:** database loss after a claim leaves the row leased instead of
  spending an application retry or marking it dead. Existing 10-minute queue and
  15-minute deployment stale-lease thresholds are deliberately unchanged. A lost
  connection around a write or external side effect has an uncertain outcome, so
  handlers do not replay whole transactions or arbitrary writes transparently;
  stale-lease reclamation remains the recovery boundary.
- **Command delivery safety:** reads and explicitly idempotent device-state PATCH
  operations retry transient 502/503/504 and transport failures with capped
  backoff. `devices:issueCommand` never retries an ambiguous outcome. The worker
  records the job as terminal `delivery_uncertain`; operators must establish the
  remote outcome before any manual replay.

See also:

- [Operations runbook](../operations/runbook.md)
- [Monitoring & logs](../operations/monitoring-and-logs.md)
