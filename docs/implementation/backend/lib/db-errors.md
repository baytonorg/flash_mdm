# `netlify/functions/_lib/db-errors.ts`

> PostgreSQL error classification and database-degraded response helpers.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `isMissingRelationError` | `(err: unknown) => boolean` | Returns true if the error is a Postgres `42P01` (undefined_table) error |
| `isDatabaseInfrastructureError` | `(err: unknown) => boolean` | Recognises PostgreSQL connection-class SQLSTATEs, startup/shutdown/capacity states, Node network codes, and nested driver causes without classifying ordinary SQL failures as retryable infrastructure errors |
| `databaseUnavailableResponse` | `(retryAfterSeconds?: number) => Response` | Returns a machine-readable HTTP 503 with bounded `Retry-After` and `X-Flash-Degraded: database` headers |
| `DATABASE_RETRY_AFTER_SECONDS` | `number` | Default five-second degraded response delay |

## Key Logic

Missing-relation detection still checks for SQLSTATE `42P01`. Infrastructure
classification walks a bounded `cause` chain and accepts connection-class
SQLSTATEs plus explicit PostgreSQL availability failures. Generic Node network
codes are accepted only when the shared database wrapper tagged them at the query
or connection boundary; an unrelated AMAPI or webhook connection reset is not
misreported as a database outage. Constraint, deadlock, statement-timeout, and
application errors remain unclassified so callers cannot use this helper to
justify replaying an uncertain write.
