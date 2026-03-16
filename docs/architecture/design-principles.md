# Design principles

This page captures the key design choices that make Flash MDM work as a multi-tenant serverless system.

## Principles

- **Tenant isolation first**: enforce workspace/environment boundaries on every request.
- **Least privilege**: RBAC with minimum permission floors.
- **Serverless realities**: assume retries, timeouts, and concurrency.
- **Idempotency by default**: webhooks and background jobs should tolerate replays.
- **Auditability**: record security-relevant actions in an audit log.
- **Defense in depth**: CSRF, SSRF mitigation, input validation, timing-safe comparisons.

## Consequences

- Some operations are asynchronous (job queues, scheduled reconciliation).
- The operator must provide external controls (monitoring, backups, IAM hygiene).
