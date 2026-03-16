# `netlify/functions/enrollment-crud.ts`

> Provides get, delete, and bulk-delete operations for enrollment tokens, including best-effort AMAPI token deletion.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `deleteEnrollmentToken` | 149-215 | Deletes a single enrollment token locally and attempts a best-effort DELETE against the AMAPI `enrollmentTokens` resource. Logs an audit event on completion. |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute` | `_lib/db.js` | Database queries and deletes |
| `requireAuth` | `_lib/auth.js` | Authenticate the caller |
| `requireEnvironmentPermission` | `_lib/rbac.js` | Enforce read/write permission on the environment |
| `logAudit` | `_lib/audit.js` | Audit logging for token deletions |
| `amapiCall`, `getAmapiErrorHttpStatus` | `_lib/amapi.js` | Delete enrollment tokens from the Android Management API |
| `jsonResponse`, `errorResponse`, `getClientIp` | `_lib/helpers.js` | HTTP response utilities |

## Key Logic

1. Parses the token ID from the URL path `/api/enrolment/{id}`.
2. **GET** -- Fetches a single enrollment token by ID; requires `read` permission on its environment. Returns token metadata including QR data, policy, group, and expiry.
3. **DELETE** -- Validates the token ID exists and returns 404 if not found (before attempting any AMAPI call). Calls `deleteEnrollmentToken` which verifies environment permission (`write`), issues a best-effort AMAPI DELETE if `amapi_name` exists (swallows errors for already-expired tokens), removes the local DB row, and logs an audit event.
4. **POST /api/enrolment/bulk** -- Bulk delete operation. Accepts a `selection` object with either explicit `ids` or `all_matching` (with optional `excluded_ids`). Iterates each target, validates it belongs to the specified `environment_id`, calls `deleteEnrollmentToken` per item, and returns a summary with per-item results (`ok`/`error`).

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/enrolment/:id` | Authenticated user with `read` permission | Get a single enrollment token |
| `DELETE` | `/api/enrolment/:id` | Authenticated user with `write` permission | Delete a single enrollment token |
| `POST` | `/api/enrolment/bulk` | Authenticated user with `write` permission | Bulk delete enrollment tokens |
