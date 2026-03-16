# `netlify/functions/_lib/deployment-sync.ts`

> Synchronizes policy derivatives to AMAPI after deployment configuration changes, handling environment, group, and device scopes.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `syncAffectedPoliciesToAmapi` | `(affectedPolicyIds: string[], environmentId: string, scopeType: PolicyScopeType, scopeId: string) => Promise<{attempted, synced, failed, skipped_reason, failures}>` | Syncs all affected policy derivatives to AMAPI and re-assigns devices to updated derivatives |
| `selectPoliciesForDeploymentScope` | `(client: {query}, environmentId: string, scopeType: string, scopeId: string) => Promise<{rows}>` | Queries the database for policies affected by a deployment at the given scope |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne` | `_lib/db.ts` | Fetching individual policy config from the database |
| `getAmapiErrorHttpStatus` | `_lib/amapi.ts` | Extracting HTTP status from AMAPI errors for failure reporting |
| `ensurePolicyDerivativeForScope` | `_lib/policy-derivatives.ts` | Creating/updating scope-specific policy derivatives |
| `syncPolicyDerivativesForPolicy` | `_lib/policy-derivatives.ts` | Regenerating all derivative payloads from deployment tables |
| `getPolicyAmapiContext` | `_lib/policy-derivatives.ts` | Resolving enterprise/workspace AMAPI context for an environment |
| `assignPolicyToDeviceWithDerivative` | `_lib/policy-derivatives.ts` | Pushing updated derivative assignment to a device via AMAPI |
| `listAffectedDevicesForPolicyContext` | `_lib/policy-derivatives.ts` | Listing devices affected by a policy change at a given scope |

## Key Logic

**`syncAffectedPoliciesToAmapi`** orchestrates the full sync flow for each affected policy:

1. Resolves the AMAPI context (enterprise binding, workspace project) for the environment. If not configured, all policies are skipped with an explanatory reason.
2. For group/device scopes, ensures a scope-specific policy derivative exists via `ensurePolicyDerivativeForScope`.
3. Fetches the base policy config and strips deployment-managed fields (`openNetworkConfiguration`, `deviceConnectivityManagement`, `applications`) so the derivative generator can re-apply them from the deployment tables.
4. Calls `syncPolicyDerivativesForPolicy` to regenerate all derivative payloads.
5. Iterates through all affected devices and re-assigns each to its updated derivative. Device assignment failures are logged as warnings but do not fail the overall sync.
6. Returns a summary with counts of attempted, synced, and failed policies, plus detailed failure info including AMAPI HTTP status codes.

**`selectPoliciesForDeploymentScope`** builds scope-appropriate SQL queries:

- **Environment scope**: Returns all policies in the environment.
- **Device scope**: Resolves the device's effective policy through a priority chain: device assignment > group assignment (nearest ancestor) > environment assignment > legacy `device.policy_id` fallback. Uses `LATERAL` subqueries with `COALESCE` for the resolution.
- **Group scope**: Similar to device scope but finds all devices that are descendants of the target group (via `group_closures`) and resolves each device's effective policy.
