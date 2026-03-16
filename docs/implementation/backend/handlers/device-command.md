# `netlify/functions/device-command.ts`

> Issues a single device management command (lock, wipe, reboot, enable/disable, etc.) via the Android Management API.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `summarizeAmapiResultForAudit` | 23-39 | Extracts a concise summary (name, done, state, error) from an AMAPI response for audit logging |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute` | `_lib/db.js` | Database reads and writes |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentResourcePermission` | `_lib/rbac.js` | Per-environment RBAC enforcement |
| `getDeviceCommandPermissionAction` | `_lib/device-command-permissions.js` | Resolving required RBAC permission for a command |
| `DEVICE_COMMAND_TYPES`, `isDeviceCommandType`, `isPatchStateCommandType` | `_lib/device-commands.js` | Shared command catalog, validation guard, and PATCH-command routing |
| `amapiCall`, `getAmapiErrorHttpStatus` | `_lib/amapi.js` | Android Management API HTTP calls and error handling |
| `buildAmapiCommandPayload`, `AmapiCommandValidationError` | `_lib/amapi-command.js` | Building the AMAPI command request body with validation |
| `logAudit` | `_lib/audit.js` | Audit trail logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp`, `isValidUuid` | `_lib/helpers.js` | HTTP response helpers, body parsing, UUID validation |

## Key Logic

1. Accepts a POST with `device_id`, `command` (or `command_type`), and optional `params`.
2. Normalizes command input to uppercase and validates against shared `DEVICE_COMMAND_TYPES` from `_lib/device-commands.ts`.
3. Looks up the device, its environment, and workspace to obtain GCP project and enterprise context.
4. Two execution paths based on command type (using `isPatchStateCommandType`):
   - **ENABLE/DISABLE**: Issues a PATCH to the AMAPI device resource with `?updateMask=state`, then updates the local `devices.state` column.
   - **All other commands**: Builds the command payload via `buildAmapiCommandPayload` and calls `:issueCommand` on the AMAPI device resource.
5. Logs an audit entry with the command, params, and a summarized AMAPI result.
6. AMAPI errors are caught and returned with the upstream HTTP status (or 502 as fallback).

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/device-command` | Session/API key | Issue a management command to a single device |
