# `netlify/functions/license-assign.ts`

> Assigns or unassigns a licence from a device within a licensing-enabled workspace.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (handler) | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| (none) | | All logic is inline within the handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `requireAuth` | `_lib/auth` | Authenticate the caller |
| `queryOne`, `execute` | `_lib/db` | Database queries and writes |
| `requireEnvironmentPermission` | `_lib/rbac` | Verify caller has write permission on the device's environment |
| `jsonResponse`, `errorResponse`, `parseJsonBody` | `_lib/helpers` | HTTP response helpers and JSON body parsing |
| `logAudit` | `_lib/audit` | Record audit trail entries |
| `getWorkspaceLicensingSettings` | `_lib/licensing` | Check whether licensing is enabled for the workspace |

## Key Logic

1. Only accepts `POST` requests.
2. Determines whether the operation is **assign** or **unassign** based on the URL pathname ending in `/unassign`.
3. Looks up the device by `device_id`, resolves its environment and workspace.
4. Verifies licensing is enabled for the workspace (`effective_licensing_enabled`).
5. Requires `write` permission on the device's environment.
6. **Unassign path**: Sets `license_id = NULL` on the device and logs an audit event.
7. **Assign path**:
   - Finds the most recent active licence for the workspace.
   - Looks up the licence plan's `max_devices` limit.
   - If `max_devices != -1`, counts currently-assigned devices and rejects if the limit is reached.
   - Updates the device's `license_id` to the licence ID and logs an audit event.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/.netlify/functions/license-assign` | Session / API key | Assign a licence to a device |
| `POST` | `/.netlify/functions/license-assign/unassign` | Session / API key | Unassign a licence from a device |
