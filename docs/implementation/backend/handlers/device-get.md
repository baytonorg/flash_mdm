# `netlify/functions/device-get.ts`

> Retrieves full device details (with apps, locations, audit log, and policy resolution), and supports device deletion, renaming, group reassignment, and AMAPI refresh.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `parseJsonObject` | 46-57 | Safely parses a value into a plain object, handling strings and nulls |
| `resolveScopeName` | 59-73 | Looks up a human-readable name for a scope (environment, group, or device) |
| `resolvePolicyName` | 75-78 | Looks up a policy's display name by ID |
| `resolveEffectiveLocalPolicy` | 80-153 | Resolves the effective policy for a device by walking the assignment hierarchy: device -> group (via closure table) -> environment -> legacy `devices.policy_id` |
| `listGroupAncestors` | 155-165 | Returns all ancestor groups for a given group via the closure table |
| `buildOverrideContributors` | 167-250 | Collects app and network deployment overrides at environment, group (all ancestors), and device scope |
| `summarizeDerivativeRow` | 252-269 | Formats a `policy_derivatives` row into a response-friendly object with scope name and generation hash |
| `buildPolicyResolution` | 271-448 | Assembles the full policy resolution diagnostic block: base policy, AMAPI applied/expected derivative comparison, override contributors, and device-scoped variables |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `query`, `execute` | `_lib/db.js` | Database reads and writes |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentResourcePermission`, `requireGroupPermission` | `_lib/rbac.js` | Per-environment and group-level RBAC enforcement |
| `amapiCall`, `getAmapiErrorHttpStatus` | `_lib/amapi.js` | Android Management API HTTP calls and error handling |
| `logAudit` | `_lib/audit.js` | Audit trail logging |
| `jsonResponse`, `errorResponse`, `getClientIp`, `parseJsonBody`, `isValidUuid` | `_lib/helpers.js` | HTTP response helpers, body parsing, UUID validation |
| `ensurePreferredDerivativeForDevicePolicy` | `_lib/policy-derivatives.js` | On-demand derivative selection/backfill for policy resolution diagnostics |
| `deriveDeviceApplicationsFromSnapshot` | `_lib/device-apps.js` | Fallback app list extraction from device snapshot when no `device_applications` rows exist |

## Key Logic

The handler supports four HTTP methods, with the device ID extracted from the URL path:

**GET** -- Returns the full device record joined with group and policy names, plus:
- Installed applications (from `device_applications` table, falling back to snapshot parsing)
- Last 10 status reports, last 50 locations, last 20 audit log entries
- A `policy_resolution` block that traces the effective policy from assignment through derivative selection, comparing the AMAPI-applied policy name against the expected derivative. Includes override contributors (apps/networks) at each scope level.
- Falls back to group-level permission if environment-level read access is denied.

**DELETE** -- Soft-deletes the device:
- Calls AMAPI `devices.delete` (tolerates 404 if already removed upstream).
- Sets `deleted_at` on the local device row.
- Cleans up device-scoped `app_deployments`, `network_deployments`, `policy_assignments`, and `policy_derivatives`.

**PUT** -- Updates device name or group assignment:
- If `group_id` is provided, validates the group exists in the same environment and updates the assignment.
- Otherwise expects `name` and renames the device.

**POST** -- Refreshes device data from AMAPI:
- Fetches the latest device resource from the Android Management API.
- Updates local columns (serial number, IMEI, manufacturer, model, OS version, security patch, state, ownership, management mode, compliance, snapshot).

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/.netlify/functions/device-get/{deviceId}` | Session/API key | Retrieve full device details with policy resolution |
| DELETE | `/.netlify/functions/device-get/{deviceId}` | Session/API key | Soft-delete a device (with AMAPI deletion) |
| PUT | `/.netlify/functions/device-get/{deviceId}` | Session/API key | Update device name or group assignment |
| POST | `/.netlify/functions/device-get/{deviceId}` | Session/API key | Refresh device data from AMAPI |
