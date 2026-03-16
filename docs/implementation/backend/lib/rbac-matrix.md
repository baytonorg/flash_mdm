# `netlify/functions/_lib/rbac-matrix.ts`

> Utilities for reading, validating, merging, and persisting workspace-level RBAC permission matrix overrides.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `RbacMatrixMeta` | `interface` | Metadata shape containing available roles, resource order, and action order |
| `getRbacMatrixMeta` | `() => RbacMatrixMeta` | Returns metadata for rendering RBAC matrix UIs (roles, resource order, action order) |
| `cloneDefaultPermissionMatrix` | `() => PermissionMatrix` | Returns a deep clone of `DEFAULT_PERMISSION_MATRIX` |
| `mergePermissionMatrixWithDefaults` | `(value: unknown) => PermissionMatrix` | Merges a partial/untrusted matrix into defaults, enforcing minimum role floors per resource/action |
| `validateAndCanonicalizePermissionMatrix` | `(value: unknown) => PermissionMatrix` | Strict validation: rejects unknown resources/actions, missing actions, invalid roles, and floor violations; throws `Error` on failure |
| `getWorkspaceRbacOverridesFromSettings` | `(settings: unknown) => PermissionMatrix \| null` | Extracts and merges the permission matrix from a workspace settings JSONB object; returns null if not present |
| `setWorkspaceRbacSettings` | `(settings: unknown, matrix: PermissionMatrix, updatedByUserId: string \| null) => JsonObject` | Returns a new settings object with `rbac.permission_matrix`, `rbac.updated_at`, and `rbac.updated_by_user_id` set |
| `clearWorkspaceRbacSettings` | `(settings: unknown) => JsonObject` | Removes `permission_matrix`, `updated_at`, and `updated_by_user_id` from the rbac section; removes the rbac key entirely if empty |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `DEFAULT_PERMISSION_MATRIX` | `_lib/rbac.ts` | Base permission matrix to clone and merge against |
| `RBAC_ROLE_VALUES` | `_lib/rbac.ts` | Valid role values for validation |
| `getPermissionMatrixMinimumRoleFloor` | `_lib/rbac.ts` | Non-overridable floor roles per resource/action |
| `workspaceRoleMeetsMinimum` | `_lib/rbac.ts` | Role hierarchy comparison |
| `PermissionMatrix` (type) | `_lib/rbac.ts` | Permission matrix type |
| `WorkspaceRole` (type) | `_lib/rbac.ts` | Role union type |

## Key Logic

This module provides the read/write/validation layer for workspace-customizable RBAC matrices stored in the workspace `settings` JSONB column.

`mergePermissionMatrixWithDefaults` is lenient: it ignores unknown resources/actions and silently clamps roles that fall below the minimum floor. `validateAndCanonicalizePermissionMatrix` is strict: it throws descriptive errors for any structural or value violations and is intended for admin-facing endpoints.

`setWorkspaceRbacSettings` and `clearWorkspaceRbacSettings` operate on immutable copies of the settings object and return new objects suitable for writing back to the database. They preserve any other keys within the settings and rbac sections.

The `ACTION_ORDER` constant defines a canonical display order for all known permission actions, used by `getRbacMatrixMeta` to drive UI rendering of the RBAC configuration screen.
