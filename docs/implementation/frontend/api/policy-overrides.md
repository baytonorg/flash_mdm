# `src/api/queries/policy-overrides.ts`

> React Query hooks for reading, saving, and resetting per-scope policy overrides, plus querying inherited lock state.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `InheritedLockState` | `interface` | Lock state inherited from parent scopes: fully_locked flag, locked_sections list, locked_by scope info |
| `PolicyOverrideResponse` | `interface` | Override config, effective base config, has_overrides flag, creator/timestamps, and lock state |
| `overrideKeys` | `object` | Query key factory: `all`, `override(policyId, scopeType, scopeId)`, `locks(policyId, scopeType, scopeId)` |
| `usePolicyOverride` | `(policyId, scopeType, scopeId) => UseQueryResult<PolicyOverrideResponse>` | Fetches override config and lock state for a group or device scope |
| `useInheritedLocks` | `(policyId, scopeType, scopeId) => UseQueryResult<InheritedLockState>` | Fetches only the inherited lock state for a scope |
| `useSavePolicyOverride` | `() => UseMutationResult` | Saves override config for a scope; invalidates overrides, policies, devices |
| `useResetPolicyOverride` | `() => UseMutationResult` | Deletes all overrides for a scope; invalidates overrides, policies, devices |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- Policy overrides allow group or device-level customization of a base policy without modifying the policy itself.
- The `lock_state` in the override response indicates which sections are locked by parent scopes (environment or parent group), preventing the current scope from overriding them.
- `useInheritedLocks` is a lighter query that returns only lock state without the full override config.
- Save and reset mutations invalidate `policy-overrides`, `policies`, and `devices` caches to keep all views consistent.
