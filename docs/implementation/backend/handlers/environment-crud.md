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

- **DELETE /:id**: Requires `delete` permission. Transactionally detaches environment and device references in audit history, deletes environment Pub/Sub events and queued jobs, then deletes the environment row. Foreign keys cascade to local devices and their reports, policies/versions/derivatives, groups/memberships, apps/deployments, networks, workflows, certificates, enrollment records and other environment-scoped records. Workspace users, workspace membership and billing subscriptions survive. Sessions survive with environment/group context cleared. No Google deletion or device command is sent; the external enterprise and its resources remain and can be discovered for recovery.

  Before deletion, the parent environment is locked. If API keys or scoped/assigned signup links exist, the caller must explicitly send `confirm_access_cleanup=true`. The Settings confirmation has a separate checkbox explaining these consequences. With confirmation, environment API-key records and dedicated environment/group signup links are deleted, while shared links keep their identity and other assignments. Cleanup and environment deletion share the same transaction. Audit history is retained by nulling environment and device foreign-key references before the cascade. Each optional legacy cleanup statement uses a savepoint so missing tables/columns do not abort the transaction. Other dependency failures return 409 with rollback and a support-oriented message. The completion audit records confirmation and cleanup counts; an API-key actor whose key was removed retains principal attribution without a dangling key FK. Implementation authority was explicitly given on 3 November 2026; this does not authorise deleting any particular live target.

  The confirmation also offers a JSON audit download before deletion. It uses the existing audit-read and privileged-entry permissions, loads all pages with a fixed upper timestamp and stable ordering, redacts sensitive detail keys and omits IP addresses. Page failures or count changes abort the export. The file includes only entries the caller may read, not a promise of all privileged history. It excludes the subsequent deletion event. Audit history remains in Flash after deletion, although the deleted environment can no longer be used as a navigation scope.

  Validation: `environment-deletion.integration.test.ts` runs the handlers against synthetic records in a named disposable localhost PostgreSQL database with the deployed schema. Enable it with `FLASH_DELETION_TEST_URL`; it never calls Google. Normal unit tests cover the handler with mocks and do not prove database cascades.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/.netlify/functions/environment-crud?workspace_id=` (action=`list`) | Session / API key | List environments for a workspace (visibility-filtered) |
| GET | `/.netlify/functions/environment-crud/:id` | Session / API key | Get a single environment by UUID |
| POST | `/.netlify/functions/environment-crud/create` | Session / API key | Create a new environment with root group and default policy |
| PUT | `/.netlify/functions/environment-crud/update` | Session / API key | Update environment fields (syncs to AMAPI if bound) |
| DELETE | `/.netlify/functions/environment-crud/:id` | Session / API key | Delete an environment |
