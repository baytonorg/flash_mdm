# `netlify/functions/workspace-users.ts`

User list rows include the existing account-level `last_login_at` timestamp alongside workspace `joined_at`. The Users table labels it `Last login (account)` because sign-in is not attributed to an environment. Existing workspace/scoped list filtering is unchanged. No login IP, authentication method, session or credential data is added.

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
- **POST /bulk**: Reports ineligible selections per target, then applies the eligible batch as one transaction. A final-state ownership conflict or write failure rolls back the entire eligible batch. Explicit bulk role overrides also apply to the selected child grants.
- **PUT /role**: Changes only the workspace role. Independent child roles are preserved. Only workspace-wide owner seats count towards surviving workspace ownership.
- **PUT /access**: Atomically changes scope, optional `workspace_role`, and selected assignments. An explicit `scoped_role` replaces selected direct roles; otherwise existing child roles survive and new grants default to the workspace role. Revalidates tenant boundaries and management paths under locks.
- **DELETE /:user_id**: Atomically removes the seat and all child grants in this workspace, clears inaccessible session selections and preserves identity, other workspaces, independent keys and shared data. Affected pending offers require explicit `cancel_pending_invites` acknowledgement.
- **POST /leave**: Deliberate session-authenticated self-removal with the same ownership and cleanup rules.
- **POST /transfer-ownership**: A current workspace-wide owner promotes an existing consenting member to workspace-wide ownership and selects their own resulting role or removal, in one transaction. Consent is an operator acknowledgement, not a separate recipient invitation workflow.

Administrative mutations enforce the appropriate `manage_users` permission and prevent implicit self-modification. The separate leave and transfer actions have explicit session-only guards. See [Membership lifecycle](../../../security/membership-lifecycle.md) for the complete contract and verification route.

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
