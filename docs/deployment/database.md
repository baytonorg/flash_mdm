# Database

Flash MDM uses **PostgreSQL** as its system of record.

## 1) Connection model (serverless)

Netlify Functions are short-lived and horizontally scaled. Flash MDM creates a small connection pool per runtime instance.

Relevant code:

- `netlify/functions/_lib/db.ts`

Key properties (as built):

- `max: 5`
- `idleTimeoutMillis: 30000`
- `connectionTimeoutMillis: 5000`
- TLS:
  - `NODE_ENV === 'development'` → TLS disabled
  - otherwise: `ssl: { rejectUnauthorized: true }`

The connection string is read from `DATABASE_URL`, falling back to `NETLIFY_DATABASE_URL` if not set.

> Operator note: for production deployments, ensure your PostgreSQL endpoint supports TLS with a valid CA chain.

## 2) Connection string normalization

`normalizePostgresConnectionString()` (in `netlify/functions/_lib/postgres-connection.ts`) rewrites `sslmode` query parameters to `verify-full` for `postgres://` and `postgresql://` connection strings. It normalizes `prefer`, `require`, and `verify-ca` values. Strings with `uselibpqcompat=true` are passed through unchanged.

## 3) Migrations

Migrations live in:

- `netlify/migrations/`

They are applied via the `/api/migrate` endpoint rather than by running SQL files directly in production. See: [Migrations & rollbacks](./migrations-and-rollbacks.md)

## 4) Backups and restore

- DB is snapshotted (operator-managed), not per-write.

Recommended minimum for operators:

- take snapshots before high-risk releases
- practice restore into staging
- define RPO/RTO targets

See: [Backup and restore](../operations/backup-and-restore.md)
