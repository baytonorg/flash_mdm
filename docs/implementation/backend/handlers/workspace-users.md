# `netlify/functions/workspace-users.ts`

> Manages workspace membership: list users (with scoped visibility), change workspace role, update access scope and scoped role for environment/group grants, bulk operations, and remove users.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `areValidUuids` | 14-16 | Validates an array of strings are all valid UUIDs |
| `roleLevel` | 868-876 | Maps role strings to numeric levels for comparison |
| `canViewWorkspaceUsersList` | 905-911 | Returns true if the caller is a workspace-scoped admin+ or superadmin |
| `getScopedVisibilityAssignments` | 913-941 | Returns environment and group IDs the caller has scoped access to |
| `listScopedWorkspaceUsers` | 943-988 | Lists workspace users filtered to those sharing the caller's scoped environments/groups |
| `filterEnvironmentAssignments` | 990-994 | Filters environment assignment rows to a set of allowed environment IDs |
| `filterGroupAssignments` | 996-1000 | Filters group assignment rows to a set of allowed group IDs |
| `hasScopedInviteCapability` | 1002-1027 | Checks if a user has admin+ role on any environment or group in the workspace |
| `listWorkspaceUsers` | 1029-1059 | Queries all workspace members (optionally filtered to a single user); handles missing `access_scope` column gracefully |
| `listEnvironmentAssignments` | 1061-1073 | Returns environment membership rows for all users in a workspace |
| `listGroupAssignments` | 1075-1090 | Returns group membership rows for all users in a workspace |
| `mapWorkspaceUsers` | 1092-1127 | Merges user rows with their environment and group assignment arrays |

## Internal Types

| Name | Lines | Description |
|------|-------|-------------|
| `BulkSelection` | 18-22 | Shape for selecting users by explicit IDs or all-matching with exclusions |
| `WorkspaceUsersBulkBody` | 24-34 | Request body for the bulk endpoint |
| `WorkspaceUserRow` | 836-844 | Row shape for a workspace member |
| `EnvironmentAssignmentRow` | 851-856 | Row shape for an environment membership |
| `GroupAssignmentRow` | 858-866 | Row shape for a group membership |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute`, `transaction` | `_lib/db.js` | Database access |
| `requireAuth` | `_lib/auth.js` | Session / API key authentication |
| `getWorkspaceAccessScope`, `getWorkspaceAccessScopeForAuth`, `getWorkspaceRole`, `requireWorkspacePermission` | `_lib/rbac.js` | RBAC enforcement and scope resolution |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getSearchParams`, `getClientIp`, `isValidUuid` | `_lib/helpers.js` | HTTP helpers and validation |

## Key Logic

- **GET (list)**: Workspace-scoped admins/owners see the full user list. Scoped users see only members who share their environment/group assignments. The response includes `limited_view: true/false` to let the UI adapt.
- **POST /bulk**: Accepts a selection (explicit IDs or `all_matching` with exclusions) and an operation (`remove` or `access_overwrite`). Iterates per user inside a loop; each user operation is individually fenced so failures don't block others. Role cascade: when a role override is applied, workspace/environment/group membership roles are all updated in a transaction.
- **PUT /role**: Changes a single user's workspace role. Cascades the role change to environment and group memberships within a transaction. Non-owners cannot promote to or demote from owner.
- **PUT /access**: Updates a user's `access_scope` (workspace vs scoped), optional `scoped_role`, and rewrites their environment/group assignment sets atomically. Validates that all supplied environment/group IDs belong to the workspace. If `scoped_role` is omitted, scoped memberships use the workspace membership role.
- **DELETE /:user_id**: Removes a user from the workspace and cascades deletion to environment and group memberships.

All mutating endpoints enforce `manage_users` permission and prevent self-modification.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/.netlify/functions/workspace-users?workspace_id=` | Session / API key | List workspace members with environment/group assignments |
| POST | `/.netlify/functions/workspace-users/bulk` | Session / API key | Bulk remove or overwrite access for multiple users |
| PUT | `/.netlify/functions/workspace-users/role` | Session / API key | Change a single user's workspace role |
| PUT | `/.netlify/functions/workspace-users/access` | Session / API key | Update a user's access scope and environment/group assignments |
| DELETE | `/.netlify/functions/workspace-users/:user_id?workspace_id=` | Session / API key | Remove a user from the workspace |

## Known Limitation

- Workspace-level access updates currently apply one `scoped_role` value to all scoped environment/group grants included in that save operation.  
- For different roles per environment, workspace admins must switch into each environment context and update that environment's scoped grants separately.
