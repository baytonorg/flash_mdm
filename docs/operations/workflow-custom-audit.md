# Primary workflow audit actions

An `audit.log` workflow requests an audit record as its primary effect. It uses
strict persistence, whereas ordinary secondary product auditing remains best-effort.
A failed or zero-row primary insert yields a failed workflow execution rather than
`audit_logged: true`. Failure of the secondary workflow-engine audit does not
recursively invent another success or audit attempt.

New requested records always use the reserved `workflow.custom_audit` action,
system actor and privileged visibility. Their sanitised details retain a bounded
`requested_action` label, `custom_workflow_action: true`, the actual workflow ID
and execution ID. Operator-authored details cannot override that provenance or
impersonate a native `auth.login`, deletion or other lifecycle action. The Audit
Log, device activity and Recent Events display `Custom workflow audit`, distinct
from the engine's `workflow.execution.*` events.

If only the legacy `api_key_id` column is missing, a system primary write can
fall back while preserving actor and visibility columns. If those security
columns are unavailable, strict primary writes fail closed. The existing generic
secondary-audit compatibility path is unchanged. No historical records or
configured action labels are rewritten.

Required CI runs the actual evaluator and worker against a separate synthetic
PostgreSQL database. It covers primary/secondary success and failure, zero-row
inserts, safe and unsafe legacy schemas, forged provenance and a transient write
failure followed by a later explicit attempt. The current worker considers a 200
response a completed dispatch even when `workflow_executions.status` is failed.
Automatic business-effect retry, durable execution idempotency and cross-effect
transactions remain separate under issue #275; this change does not introduce
replay or claim exactly-once audit delivery.

Production acceptance is read-only: inspect deployed version, availability,
configuration counts and source, without creating a live audit workflow or audit
record. Actual UI acceptance uses synthetic records in an isolated browser.
