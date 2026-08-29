# `health.ts`

> Public readiness endpoint for deployment monitoring and release verification.

## Route

| Method | Path | Authentication |
|---|---|---|
| `GET` | `/api/health` | None |

## Behaviour

The handler runs a minimal `SELECT 1` database check. A ready deployment returns HTTP 200 with `status`, `database`, `version`, and `runtime`. `version` comes from `FLASH_RELEASE_COMMIT` on VPS or Netlify's `COMMIT_REF`. A database failure returns HTTP 503 with a generic degraded response; internal database error details are logged but never returned. Responses use `Cache-Control: no-store`.
