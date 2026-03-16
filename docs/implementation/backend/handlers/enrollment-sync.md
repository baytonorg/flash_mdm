# `netlify/functions/enrollment-sync.ts`

> Synchronizes local enrollment tokens with the Android Management API, importing new remote tokens and invalidating locally-tracked tokens that no longer exist in AMAPI.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `transaction` | `_lib/db.js` | Database queries and transactional writes |
| `requireAuth` | `_lib/auth.js` | Authenticate the caller |
| `requireEnvironmentPermission` | `_lib/rbac.js` | Enforce `write` permission on the environment |
| `amapiCall` | `_lib/amapi.js` | Paginated fetch of enrollment tokens from AMAPI |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP response utilities |

## Key Logic

1. Requires `POST` with `environment_id` in the body. Validates the environment is bound to an enterprise with a GCP project.
2. **Fetch from AMAPI**: Pages through all enrollment tokens from `{enterprise}/enrollmentTokens?pageSize=100` until no `nextPageToken` remains.
3. **Fetch local tokens**: Loads all `enrollment_tokens` rows for the environment.
4. **Reconcile in a transaction**:
   - **Import**: Tokens present in AMAPI but missing locally are inserted as new rows with a `Synced:` name prefix.
   - **Invalidate**: Local tokens whose `amapi_name` no longer appears in AMAPI have their `amapi_value` and `qr_data` nulled out and `expires_at` clamped to now (retaining metadata for a grace period so delayed enrollment events can still resolve group/policy from `amapi_name`).
5. Logs an `enrollment.tokens_synced` audit event with import/invalidation counts and returns the summary.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/enrollment-sync` | Authenticated user with `write` permission | Sync enrollment tokens between AMAPI and local DB |
