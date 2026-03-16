# `netlify/functions/environment-enterprise.ts`

> Enterprise management actions for bound environments: check enterprise upgrade eligibility, generate a Google Workspace upgrade URL, and trigger a full device re-import reconciliation.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `triggerQueueWorker` | 230-245 | Fires a best-effort HTTP POST to `sync-process-background` to kick off queued job processing after device import |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute` | `_lib/db.js` | Database access |
| `requireAuth` | `_lib/auth.js` | Authentication |
| `requireEnvironmentResourcePermission` | `_lib/rbac.js` | RBAC enforcement (`manage_settings`) |
| `amapiCall`, `getAmapiErrorHttpStatus` | `_lib/amapi.js` | Calling the Android Management API |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP helpers |

## Key Logic

The handler is POST-only and dispatches on `body.action`:

1. **`reconcile_device_import`**: Pages through the AMAPI device list for the enterprise, collects all device `name` values, then bulk-inserts `process_enrollment` jobs into `job_queue` (one per device). After enqueuing, triggers the background queue worker. This is used to re-import all devices when the environment may be out of sync with AMAPI.

2. **`get_upgrade_status`**: Fetches the enterprise resource from AMAPI and returns the `enterpriseType`, whether it is eligible for upgrade (only `MANAGED_GOOGLE_PLAY_ACCOUNTS_ENTERPRISE` is eligible), and related type fields.

3. **`generate_upgrade_url`**: Calls `enterprises:generateEnterpriseUpgradeUrl` on AMAPI to produce a URL that allows the admin to upgrade the enterprise to a Google Workspace-managed enterprise. Only available when `enterpriseType` is `MANAGED_GOOGLE_PLAY_ACCOUNTS_ENTERPRISE`.

All actions require `manage_settings` permission on the environment and that the environment is bound to an enterprise.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/environment-enterprise` | Session / API key | Enterprise management actions (upgrade status, upgrade URL, device reconciliation) |
