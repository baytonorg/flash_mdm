# `netlify/functions/migrate.ts`

> Smart database migration runner that applies pending SQL migrations idempotently, tracking state in a `_migrations` table.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `handler` | `(request: Request, context: Context) => Promise<Response>` | Default-exported Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `normalizePostgresConnectionString` | `_lib/postgres-connection` | Normalize DATABASE_URL for pg client |

## Key Logic

GET-only endpoint. Authentication is via the `x-migration-secret` header, validated with timing-safe comparison against the `MIGRATION_SECRET` environment variable.

**Migration infrastructure:**
- All migrations are inlined as an ordered array of `{ name, sql }` objects (Netlify esbuild does not bundle .sql files).
- On each run, the handler creates the `_migrations` tracking table if it does not exist, then queries for already-applied migration names.
- Each pending migration is applied inside its own `BEGIN`/`COMMIT` transaction. On error, the transaction is rolled back and processing stops (later migrations that may depend on the failed one are skipped).
- Applied migration names are recorded in `_migrations` with an `applied_at` timestamp.

**Migrations span the full schema:** foundation tables (workspaces, environments, groups, devices, policies, users, sessions), audit logging, PubSub events, job queue, licensing/billing, RBAC, enrollment tokens, API keys, app deployments, workflow engine, device telemetry, policy derivatives, billing notifications, workspace billing defaults, and the Flashi AI assistant (migrations 001 through 047).

**Connection handling:** Opens a dedicated `pg.Client` connection (not via the shared pool) using `DATABASE_URL` or `NETLIFY_DATABASE_URL`. SSL is configured based on `NODE_ENV`.

**Response:** Returns a JSON summary with total/applied/skipped/error counts plus per-migration results.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/.netlify/functions/migrate` | `x-migration-secret` header | Apply all pending database migrations |
