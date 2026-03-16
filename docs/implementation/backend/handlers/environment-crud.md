# `netlify/functions/environment-crud.ts`

> CRUD operations for environments: list (with scoped visibility), get, create (with root group and default policy), update (with AMAPI enterprise sync), and delete.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute`, `transaction` | `_lib/db.js` | Database access |
| `requireAuth` | `_lib/auth.js` | Session / API key authentication |
| `getWorkspaceAccessScopeForAuth`, `requireEnvironmentPermission`, `requireWorkspaceResourcePermission` | `_lib/rbac.js` | RBAC enforcement and access scope resolution |
| `amapiCall`, `getAmapiErrorHttpStatus` | `_lib/amapi.js` | Calling the Android Management API |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp`, `getSearchParams` | `_lib/helpers.js` | HTTP helpers |

## Key Logic

- **GET (list)**: Three visibility modes based on auth context:
  - **Environment-scoped API key**: Returns only the single environment the key is scoped to.
  - **Scoped user** (`access_scope = 'scoped'`): Returns only environments where the user has a direct environment or group membership. The `user_role` is derived from the highest-privilege membership.
  - **Workspace-wide** (superadmin, workspace-scoped key, or `access_scope = 'workspace'`): Returns all environments in the workspace.

- **GET /:id**: Returns a single environment by ID after `read` permission check.

- **POST /create**: Requires workspace `environment.write` permission. Creates:
  1. The environment row.
  2. An environment membership for the creator (role `admin`).
  3. A root group named after the environment with a self-referencing closure row.
  4. A default safety-net policy (status `draft`, empty config) with a version record and an environment-scoped policy assignment.

- **PUT /update**: Supports updating `name`, `pubsub_topic`, and `enterprise_features`. When the environment is bound to an AMAPI enterprise, name or pubsub changes are synced upstream via `PATCH` to the enterprise resource. If the AMAPI patch returns updated values, those are stored locally. PubSub topic changes also toggle `enabledNotificationTypes`.

- **DELETE /:id**: Requires `delete` permission. Deletes the environment row (cascading to related data via foreign keys).

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/.netlify/functions/environment-crud?workspace_id=` (action=`list`) | Session / API key | List environments for a workspace (visibility-filtered) |
| GET | `/.netlify/functions/environment-crud/:id` | Session / API key | Get a single environment by UUID |
| POST | `/.netlify/functions/environment-crud/create` | Session / API key | Create a new environment with root group and default policy |
| PUT | `/.netlify/functions/environment-crud/update` | Session / API key | Update environment fields (syncs to AMAPI if bound) |
| DELETE | `/.netlify/functions/environment-crud/:id` | Session / API key | Delete an environment |
