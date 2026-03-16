# `netlify/functions/device-bulk.ts`

> Queues bulk device commands (lock, wipe, reboot, delete, etc.) for up to 500 devices via the background job queue.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `execute` | `_lib/db.js` | Database reads and writes |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentResourcePermission` | `_lib/rbac.js` | Per-environment RBAC enforcement |
| `getDeviceCommandPermissionAction`, `isDestructiveDeviceCommand` | `_lib/device-command-permissions.js` | Resolving required permission for a given command type |
| `BULK_DEVICE_COMMAND_TYPES`, `isBulkDeviceCommandType`, `normalizeBulkDeviceCommand` | `_lib/device-commands.js` | Shared alias normalization and canonical command validation |
| `logAudit` | `_lib/audit.js` | Audit trail logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP response helpers, body parsing, IP extraction |

## Key Logic

1. Accepts a POST with `device_ids` (array, max 500) and `command_type` (or `action` alias).
2. Normalizes the command through `normalizeBulkDeviceCommand` (e.g. `lock` -> `LOCK`) and validates against shared `BULK_DEVICE_COMMAND_TYPES`.
3. Determines the required RBAC permission: destructive commands and `DELETE` require `bulk_destructive`; others use the standard per-command permission from `getDeviceCommandPermissionAction`.
4. Verifies all device IDs exist (soft-deleted excluded) and checks RBAC for each unique environment the devices belong to.
5. Batch-inserts one `job_queue` row per device (`device_delete` or `device_command` job type) for background processing.
6. Best-effort triggers `sync-process-background` via internal HTTP call so queued jobs execute immediately rather than waiting for the next scheduled run.
7. Logs a single audit entry summarizing the bulk action.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/device-bulk` | Session/API key | Queue a bulk command for multiple devices |
