# `netlify/functions/device-operations.ts`

> Lists, retrieves, and cancels AMAPI device operations (long-running command results) with pagination and deduplication.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `getOperationSortTimestamp` | 29-39 | Extracts a sortable timestamp from an operation's `metadata.createTime` or falls back to the numeric suffix of the operation name |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne` | `_lib/db.js` | Device and environment reads |
| `listDeviceCommandOperations` | `_lib/command-operation-ledger.js` | Persistent recent command ledger |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentResourcePermission` | `_lib/rbac.js` | Per-environment RBAC enforcement |
| `amapiCall`, `getAmapiErrorHttpStatus` | `_lib/amapi.js` | Android Management API HTTP calls and error handling |
| `logAudit` | `_lib/audit.js` | Audit trail logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getSearchParams`, `getClientIp`, `isValidUuid` | `_lib/helpers.js` | HTTP response helpers, body/query parsing, UUID validation |

## Key Logic

The handler dispatches on HTTP method and an `action` query parameter:

**GET action=list** (default for GET):
- Requires `device_id`; accepts an optional opaque `page_token`.
- Fetches one AMAPI page of 100 results, merges it with up to 500 recent persistent command-ledger rows, deduplicates by operation name, and sorts newest first.
- Returns AMAPI's continuation token so the frontend can load older history without a server-side five-page ceiling.
- On upstream 5xx errors, returns the persistent ledger with `unavailable: true`, so recent command evidence remains visible.

**GET action=get**:
- Requires `operation_name` (must start with `enterprises/`). Extracts the enterprise from the name to verify environment access, then fetches the single operation from AMAPI.
- Requires `device:write` permission.

**POST** (cancel):
- Requires `operation_name` in the request body. Calls `:cancel` on the AMAPI operation resource.
- Requires `device:delete` permission.
- Logs an audit entry on successful cancellation.

### Constants

| Name | Value | Description |
|------|-------|-------------|
| `OPERATION_PAGE_SIZE` | 100 | Page size per AMAPI list request |
| `MAX_OPERATION_ITEMS` | 600 | First-page cap preserving 500 ledger rows plus 100 live AMAPI rows |

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/.netlify/functions/device-operations?action=list&device_id={id}&page_token={token}` | Session/API key | List persistent recent operations plus one AMAPI history page |
| GET | `/.netlify/functions/device-operations?action=get&operation_name={name}` | Session/API key | Get a single operation by name |
| POST | `/.netlify/functions/device-operations` | Session/API key | Cancel a pending operation |
