# Primary workflow audit actions

An `audit.log` workflow requests an audit record as its primary effect. It uses
strict persistence, whereas ordinary secondary product auditing remains best-effort.
A failed or zero-row primary insert yields a failed workflow execution rather than
`audit_logged: true`. The primary record and authoritative success result commit in one transaction, including a savepoint for safe legacy fallback. Failure of later last-triggered metadata cannot reverse that committed effect: it is reported with `errors: 1` and a bounded warning. Failure of the secondary workflow-engine audit does not
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
columns are unavailable, strict primary writes fail closed. Secondary best-effort fallback now also preserves user/system actor and visibility when only the unused key column is absent. If actor, visibility or a key principal cannot be represented, it skips the secondary write with bounded diagnostics rather than downgrading the event. Strict or transactional writes reject the unsafe fallback. This separately resolves issue #384 without changing normal modern-schema attribution or rewriting old rows. No historical records or
configured action labels are rewritten.

Required CI runs the actual evaluator and worker against a separate synthetic
PostgreSQL database. It covers primary/secondary success and failure, zero-row
inserts, safe and unsafe legacy schemas, forged provenance, supplementary Unicode labels, outcome rollback, metadata-only failure and a transient write
failure followed by a later explicit attempt. The current worker considers a 200
response a completed dispatch even when `workflow_executions.status` is failed.
Automatic business-effect retry, durable execution idempotency and cross-effect
transactions remain separate under issue #275; this change does not introduce
replay or claim exactly-once audit delivery.

Production acceptance is read-only: inspect deployed version, availability,
configuration counts and source, without creating a live audit workflow or audit
record. Actual UI acceptance uses synthetic records in an isolated browser.

If a COMMIT acknowledgement is lost, a conditional running-to-failed transition
and authoritative terminal read preserve a committed primary success. If that
outcome cannot be read, the evaluator reports an unverified audit commit, without
claiming failure or success. A worker that can persist its delivery-uncertain
transition suppresses replay and uses audit-specific wording. A continuing
database outage can also prevent that transition, leaving an expiring lease;
durable cross-dispatch idempotency remains issue #275. Exactly-once behaviour
during that broader outage is not claimed.
