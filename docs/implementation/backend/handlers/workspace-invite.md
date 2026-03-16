# `netlify/functions/workspace-invite.ts`

> Handles the full invitation lifecycle: creating/sending workspace or platform invites, validating invite tokens, and accepting invites to grant workspace membership.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |
| `InviteType` | `type` | `'workspace_access' \| 'platform_access'` |
| `parseJsonStringArray` | `function` | Safely parses a JSON string into a `string[]` |
| `upsertWorkspaceMembershipFromInvite` | `function` | Inserts or updates a workspace membership row (with `access_scope` fallback) |
| `getInviteForAccept` | `function` | Retrieves an invite by token hash, with legacy schema compatibility |
| `getInviteTypeFromPermissions` | `function` | Extracts the invite type from the `permissions` JSONB column |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `uniqueStrings` | 318-320 | Deduplicates and trims a string array |
| `roleLevel` | 322-324 | Maps role string to numeric level |
| `canGrantRole` | 326-328 | Checks whether inviter's role is high enough to grant a target role |
| `authorizeScopedInvite` | 330-413 | Validates that the caller has sufficient permissions across all targeted environments/groups to send a scoped invite |
| `insertInviteWithSchemaCompat` | 448-507 | Inserts a new invite row; falls back to legacy single-column schema if `environment_ids`/`group_ids` columns are missing |
| `refreshInviteWithSchemaCompat` | 509-580 | Re-issues an existing pending invite with a new token and expiry; same legacy fallback |
| `parsePermissionsMetadata` | 648-658 | Parses the `permissions` JSONB column into an object |

## Constants

| Name | Value | Description |
|------|-------|-------------|
| `INVITE_EXPIRY_DAYS` | `7` | Days before an invite token expires |
| `ROLE_LEVEL` | `{ owner: 100, admin: 75, member: 50, viewer: 25 }` | Numeric role hierarchy |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute`, `transaction` | `_lib/db.js` | Database access |
| `requireAuth`, `validateSession` | `_lib/auth.js` | Authentication |
| `getEnvironmentRoleForAuth`, `getGroupRoleForAuth`, `getWorkspaceAccessScopeForAuth`, `requireWorkspaceResourcePermission` | `_lib/rbac.js` | RBAC checks for scoped invite authorization |
| `generateToken`, `hashToken` | `_lib/crypto.js` | Generating and hashing invite tokens |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `sendEmail`, `inviteEmail` | `_lib/resend.js` | Sending invite emails via Resend |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getSearchParams`, `getClientIp` | `_lib/helpers.js` | HTTP helpers |

## Key Logic

1. **POST /api/workspaces/invite** -- Creates an invite. Two types: `workspace_access` (requires `workspace_id`) and `platform_access` (superadmin-only, no workspace target). Scoped invites target specific environments/groups and require the caller to hold admin+ in each scope. If a pending invite already exists for the same email/workspace, the token is refreshed and the email is re-sent. Invite tokens are stored as SHA-256 hashes.

2. **GET /api/invites/:token** -- Validates the token, checks expiry and status, and returns invite metadata (email, role, workspace name, inviter). Does not require authentication (public validation endpoint).

3. **POST /api/invites/:token/accept** -- Requires authentication. Verifies the signed-in user's email matches the invite. Within a transaction: upserts workspace membership, creates environment/group memberships for scoped invites, and marks the invite as accepted.

Schema compatibility: all invite insert/update operations fall back to legacy single-column (`environment_id`/`group_id`) if the multi-value columns are missing, ensuring zero-downtime deployments.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/workspace-invite` (path: `/api/workspaces/invite`) | Session | Create and send a workspace or platform invite |
| GET | `/.netlify/functions/workspace-invite` (path: `/api/invites/:token`) | None | Validate an invite token and return invite details |
| POST | `/.netlify/functions/workspace-invite` (path: `/api/invites/:token/accept`) | Session | Accept an invite and join the workspace |
