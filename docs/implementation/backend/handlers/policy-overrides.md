# `netlify/functions/policy-overrides.ts`

> Manages policy overrides at group and device scope, including reading override config with inherited lock state, saving overrides (validated against locks), resetting overrides, and querying lock state.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Types

| Name | Lines | Description |
|------|-------|-------------|
| `OverrideRow` | 31-37 | Shape of a row from `group_policy_overrides` or `device_policy_overrides` |
| `PolicyRow` | 39-41 | Shape of a policy config row |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `deriveEnvironmentId` | 43-59 | Resolves `environment_id` from a group or device scope target |
| `parseJsonField` | 61-67 | Safely parses a JSON string field, returning null on failure |
| `cloneConfig` | 69-71 | Deep-clones a config object via JSON round-trip |
| `getEffectiveBaseConfig` | 73-125 | Computes the effective base config for a scope by starting from the policy's base config and merging ancestor group overrides in top-down order. For device scope, walks the device's group ancestry |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute` | `_lib/db.js` | Database operations |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentResourcePermission` | `_lib/rbac.js` | Environment-level RBAC check |
| `logAudit` | `_lib/audit.js` | Audit log entries |
| `getInheritedLocks`, `validateOverrideAgainstLocks`, `canSaveOverrides` | `_lib/policy-locks.js` | Lock state resolution, validation, and permission checks |
| `syncPolicyDerivativesForPolicy`, `getPolicyAmapiContext`, `listAffectedDevicesForPolicyContext`, `assignPolicyToDeviceWithDerivative` | `_lib/policy-derivatives.js` | Derivative regeneration and device re-assignment after override changes |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp`, `getSearchParams` | `_lib/helpers.js` | HTTP response helpers and request parsing |

## Key Logic

### Get Locks (GET /overrides/locks)
- Returns the inherited lock state for a given policy + scope (group or device) without override data.

### Get Override (GET /overrides)
- Returns the override config, whether overrides exist, the effective base config (policy base + ancestor overrides merged), and inherited lock state.
- The effective base config is computed by `getEffectiveBaseConfig`, which walks group ancestry via `group_closures` and merges overrides top-down.

### Save Override (PUT /overrides)
- Validates RBAC via `canSaveOverrides` (group admins can override unlocked sections; env admins can override everything).
- Cross-environment check ensures the policy belongs to the target scope's environment.
- Validates the override config against inherited locks (env admins bypass lock validation).
- Upserts into `group_policy_overrides` or `device_policy_overrides`.
- Triggers derivative regeneration and re-assigns affected devices to their updated derivative policies in AMAPI.

### Reset Override (DELETE /overrides)
- Deletes the override row for the given scope.
- Triggers derivative regeneration and device re-assignment (same as save).

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/.netlify/functions/policy-overrides` (sub=`locks`) | Session | Get inherited lock state for a scope |
| GET | `/.netlify/functions/policy-overrides` | Session | Get override config + lock state + effective base config |
| PUT | `/.netlify/functions/policy-overrides` | Session | Save override config for a group or device scope |
| DELETE | `/.netlify/functions/policy-overrides` | Session | Reset (delete) overrides for a scope |
