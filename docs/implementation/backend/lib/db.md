# `netlify/functions/_lib/db.ts`

> PostgreSQL connection pool and query helpers providing `query`, `queryOne`, `execute`, and `transaction` abstractions.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `query` | `<T>(sql: string, params?: unknown[]) => Promise<T[]>` | Executes a SQL query and returns all result rows |
| `queryOne` | `<T>(sql: string, params?: unknown[]) => Promise<T \| null>` | Executes a SQL query and returns the first row or null |
| `execute` | `(sql: string, params?: unknown[]) => Promise<{ rowCount: number }>` | Executes a SQL statement and returns the affected row count |
| `transaction` | `<T>(fn: (client: pg.PoolClient) => Promise<T>) => Promise<T>` | Executes a function within a BEGIN/COMMIT transaction, rolling back on error |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `getPool` | 8-21 | Lazily initializes and returns a singleton `pg.Pool` instance |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `normalizePostgresConnectionString` | `_lib/postgres-connection.ts` | Normalizing the database connection string before pool creation |

## Key Logic

The module maintains a **singleton connection pool** (max 5 connections, 30s idle timeout, 5s connection timeout). The connection string is read from `DATABASE_URL` or `NETLIFY_DATABASE_URL` environment variables.

**SSL configuration**: SSL is disabled in development (`NODE_ENV=development`), otherwise `rejectUnauthorized: true` is enforced.

**Transaction handling**: The `transaction` function acquires a client from the pool, runs `BEGIN`, executes the callback, then `COMMIT`s. On any error, it issues `ROLLBACK` before rethrowing. The client is always released back to the pool in a `finally` block.
