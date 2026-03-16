# `netlify/functions/_lib/policy-locks.ts`

> Manages hierarchical policy lock state and RBAC checks for modifying locks and saving overrides at environment, group, and device scopes.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `InheritedLockState` | `type` | Lock state: `fully_locked`, `locked_sections[]`, `locked_by_scope`, `locked_by_scope_name` |
| `getInheritedLocks` | `(scopeType: 'group' \| 'device', scopeId, policyId, environmentId) => Promise<InheritedLockState>` | Resolves the accumulated lock state for a scope by walking up the group hierarchy and checking the environment |
| `canModifyLocks` | `(auth, scopeType, scopeId, environmentId) => Promise<{ allowed, reason? }>` | RBAC check: determines if a user can set or remove locks at a given scope |
| `canSaveOverrides` | `(auth, scopeType, scopeId, environmentId) => Promise<{ allowed, can_override_locked, reason? }>` | RBAC check: determines if a user can save overrides, and whether they can override locked sections |
| `validateOverrideAgainstLocks` | `(overrideConfig, lockState) => string \| null` | Validates that an override config does not contain keys that are locked by ancestors; returns error message or `null` |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `roleLevel` | 247-250 | Maps role strings to numeric levels: owner=100, admin=75, member=50, viewer=25 |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne` | `_lib/db.js` | Querying lock state from `policy_assignments` and group hierarchy |
| `AuthContext` | `_lib/auth.js` | Typed authentication context for RBAC checks |
| `getEnvironmentRoleForAuth`, `getGroupRoleForAuth`, `WorkspaceRole` | `_lib/rbac.js` | Resolving user roles at environment and group levels |

## Key Logic

**Lock inheritance (`getInheritedLocks`):**
- For group-scoped queries, walks the `group_closures` table from parent ancestors (depth > 0) toward the target group, accumulating `locked_sections` from each ancestor's `policy_assignments` row.
- For device-scoped queries, first resolves the device's `group_id`, then follows the same group hierarchy walk.
- Environment-level locks are always checked and take precedence. A `locked: true` at the environment level fully locks the policy.
- Sections accumulate (union): if ancestor A locks `applications` and ancestor B locks `screenBrightness`, both are locked for descendants.
- Locks control editability of inherited policy config, NOT policy assignment. A child group can still assign a different policy.

**RBAC for locks (`canModifyLocks`):**
- Superadmins: always allowed.
- Environment admins/owners: can set or remove locks at any scope.
- Group admins: can set locks within their subtree only.
- Members and viewers: cannot modify locks.

**RBAC for overrides (`canSaveOverrides`):**
- Environment admins and superadmins can override even locked sections (`can_override_locked: true`).
- Group admins and members can save overrides but only for unlocked sections (`can_override_locked: false`).
- Viewers cannot modify overrides.

**Override validation (`validateOverrideAgainstLocks`):**
- Returns an error message listing conflicting keys if any override keys overlap with `locked_sections`.
- Returns `null` (valid) if no conflicts exist.
