# `netlify/functions/roles-rbac.ts`

> RBAC permission matrix management: view effective permissions per workspace or environment, update custom overrides, and reset to defaults.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `handler` | `(request: Request, context: Context) => Promise<Response>` | Default-exported Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `filterOutWorkspaceResource` | 28-35 | Removes the `workspace` resource from a permission matrix (used for environment-scoped views) |
| `filterOutBillingResource` | 37-44 | Removes the `billing` resource from a permission matrix when licensing is disabled |
| `filterBillingMeta` | 46-57 | Removes billing-related resources and actions from the matrix metadata when licensing is disabled |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute`, `queryOne` | `_lib/db` | Database operations |
| `requireAuth` | `_lib/auth` | Authentication |
| `clearWorkspacePermissionMatrixCache`, `requireEnvironmentRole`, `requireWorkspaceRole` | `_lib/rbac` | Role checks and cache invalidation |
| `cloneDefaultPermissionMatrix`, `clearWorkspaceRbacSettings`, `getRbacMatrixMeta`, `getWorkspaceRbacOverridesFromSettings`, `mergePermissionMatrixWithDefaults`, `setWorkspaceRbacSettings`, `validateAndCanonicalizePermissionMatrix` | `_lib/rbac-matrix` | Permission matrix operations |
| `errorResponse`, `getClientIp`, `getSearchParams`, `jsonResponse`, `parseJsonBody` | `_lib/helpers` | Request/response utilities |
| `logAudit` | `_lib/audit` | Audit logging |
| `getWorkspaceLicensingSettings` | `_lib/licensing` | Feature gating billing resources based on licensing state |

## Key Logic

**GET (view):** Two modes based on caller's role:
- **Workspace owners** see the full matrix (workspace + environment resources) with `can_manage: true`.
- **Non-owners** must provide `environment_id` and at minimum have `member` role. They see a filtered matrix excluding `workspace` resources, with `can_manage: false`.

Both modes return `defaults` (built-in matrix), `matrix` (effective after overrides), `has_override` flag, and `meta` (resource_order, action_order for UI rendering). When licensing is disabled, billing resources and actions are stripped from both defaults and effective matrix.

**PUT (update):** Requires workspace `owner` role. Validates and canonicalizes the submitted matrix. If licensing is disabled, preserves existing billing permissions (since the client cannot see/edit them). Stores overrides into workspace `settings` JSON, clears the permission matrix cache, and logs the change.

**DELETE (reset):** Requires workspace `owner` role. Clears custom RBAC overrides from workspace settings, reverting to the default permission matrix. Clears the cache and logs the reset.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/.netlify/functions/roles-rbac` | Session or API key | View effective RBAC permission matrix for a workspace or environment |
| `PUT` | `/.netlify/functions/roles-rbac` | Session or API key (workspace owner) | Update custom RBAC permission overrides |
| `DELETE` | `/.netlify/functions/roles-rbac` | Session or API key (workspace owner) | Reset RBAC permissions to defaults |
