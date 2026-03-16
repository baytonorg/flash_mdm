# `netlify/functions/policy-assign.ts`

> Handles policy assignment, unassignment, listing assignments, and resolving the effective policy for a device using a scope-based cascade (device > group hierarchy > environment > legacy).

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `deriveEnvironmentId` | 23-49 | Resolves the `environment_id` from a scope target (environment, group, or device) |
| `resolveScopeName` | 54-77 | Returns a human-readable name for a scope target (env name, group name, or device serial) |
| `findEffectivePolicyForDevice` | 83-123 | Walks the policy cascade (device assignment > group hierarchy > environment > legacy `devices.policy_id`) to find the effective policy for a device |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute`, `transaction` | `_lib/db.js` | Database operations |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentAccessScopeForResourcePermission`, `requireEnvironmentResourcePermission`, `requireGroupPermission` | `_lib/rbac.js` | RBAC permission checks at environment and group level |
| `canModifyLocks` | `_lib/policy-locks.js` | Check if user can set/modify lock state on assignments |
| `logAudit` | `_lib/audit.js` | Audit log entries |
| `assignPolicyToDeviceWithDerivative`, `syncPolicyDerivativesForPolicy`, `getPolicyAmapiContext`, `ensurePolicyDerivativeForScope`, `listAffectedDevicesForPolicyContext` | `_lib/policy-derivatives.js` | AMAPI derivative policy generation and device sync |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp`, `getSearchParams` | `_lib/helpers.js` | HTTP response helpers and request parsing |

## Key Logic

### Assign (POST /assign)
1. Validates `policy_id`, `scope_type` (environment/group/device), and `scope_id`.
2. RBAC: environment admins can assign at any scope; group admins can assign within their subtree (fallback check).
3. Prevents cross-environment assignment (policy must belong to the target environment).
4. Lock permissions: users without lock permission preserve existing lock state; users with lock permission can set `locked` and `locked_sections`.
5. Upserts into `policy_assignments` (unique on `scope_type + scope_id`). For device scope, also updates `devices.policy_id`.
6. Triggers AMAPI derivative sync: ensures scope-specific derivative exists, regenerates all derivatives for the policy, then assigns each affected device to its derivative policy in AMAPI. Device sync failures are non-fatal.

### Unassign (POST /unassign)
1. Captures affected devices BEFORE deleting the assignment row (otherwise the cascade query finds nothing).
2. Deletes the `policy_assignments` row; for device scope, clears `devices.policy_id`.
3. Re-syncs each affected device to its new effective policy (walks the cascade via `findEffectivePolicyForDevice`).
4. Cleans up orphaned `policy_derivatives` rows for the removed scope.

### List Assignments (GET /assignments)
1. Returns all assignments for an environment, respecting group-scoped RBAC (scoped users only see assignments relevant to their groups).
2. Enriches each assignment with a resolved `scope_name`.

### Effective Policy (GET /effective)
1. Walks the four-level cascade for a given `device_id`: direct device assignment, group hierarchy (nearest ancestor), environment assignment, legacy `devices.policy_id`.
2. Returns the policy ID, name, source type, source ID, and source name.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/policy-assign` (action=`assign`) | Session | Assign a policy to a scope (environment, group, or device) |
| POST | `/.netlify/functions/policy-assign` (action=`unassign`) | Session | Remove a policy assignment from a scope |
| GET | `/.netlify/functions/policy-assign` (action=`assignments`) | Session | List all policy assignments for an environment |
| GET | `/.netlify/functions/policy-assign` (action=`effective`) | Session | Resolve the effective policy for a specific device |
