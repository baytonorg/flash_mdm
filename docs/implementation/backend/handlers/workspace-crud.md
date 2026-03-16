# `netlify/functions/workspace-crud.ts`

> CRUD operations for workspaces: list, get, create, update, and store GCP service account credentials. Also discovers orphaned Android enterprises not linked to any environment.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `listDisassociatedEnterprises` | 300-369 | Queries AMAPI for all enterprises in a GCP project, filters out those already linked to environments, hydrates each with display name / pubsub / device count |
| `countEnterpriseDevices` | 371-404 | Pages through AMAPI device list for an enterprise and returns a count (capped at 5 000) |

## Internal Interfaces

| Name | Lines | Description |
|------|-------|-------------|
| `AmapiEnterpriseListResponse` | 278-286 | Shape of the AMAPI enterprises.list response |
| `AmapiEnterpriseDetails` | 288-293 | Shape of a single AMAPI enterprise resource |
| `AmapiDeviceListResponse` | 295-298 | Shape of the AMAPI devices.list response |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute` | `_lib/db.js` | Database access |
| `requireAuth` | `_lib/auth.js` | Session / API key authentication |
| `requireWorkspacePermission`, `requireWorkspaceResourcePermission` | `_lib/rbac.js` | RBAC enforcement |
| `encrypt` | `_lib/crypto.js` | Encrypting GCP service account credentials at rest |
| `amapiCall`, `getAmapiErrorHttpStatus` | `_lib/amapi.js` | Calling the Android Management API |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp`, `getSearchParams` | `_lib/helpers.js` | HTTP helpers |

## Key Logic

The handler routes on `request.method` plus a path segment parsed from the URL:

1. **List** -- superadmins see all workspaces; API keys see only their scoped workspace; session users see workspaces they have a membership in.
2. **Get by ID** -- returns a single workspace with the caller's role and access scope.
3. **Create** -- superadmin-only; inserts a workspace row and adds the creator as owner.
4. **Update** -- requires workspace `write`; dynamically builds an `UPDATE` statement from provided fields (`name`, `gcp_project_id`, `default_pubsub_topic`).
5. **Secrets** -- requires `manage_settings`; validates uploaded JSON is a GCP service account, encrypts it via `encrypt()`, and stores it. Also extracts the `project_id` from the JSON to backfill `gcp_project_id`.
6. **Orphaned enterprises** -- calls AMAPI to list all enterprises under the GCP project, diffs against locally linked `environments.enterprise_name`, and returns the orphans with device counts and display metadata. Fails soft (returns empty array + `unavailable` flag) so the UI panel degrades gracefully.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/.netlify/functions/workspace-crud` (action=`list`) | Session / API key | List workspaces visible to the caller |
| GET | `/.netlify/functions/workspace-crud/orphaned-enterprises?workspace_id=` | Session / API key | Discover AMAPI enterprises not linked to any environment |
| GET | `/.netlify/functions/workspace-crud/:id` | Session / API key | Get a single workspace by UUID |
| POST | `/.netlify/functions/workspace-crud/create` | Session (superadmin) | Create a new workspace |
| PUT | `/.netlify/functions/workspace-crud/update` | Session / API key | Update workspace fields |
| POST | `/.netlify/functions/workspace-crud/secrets` | Session / API key | Store encrypted GCP service account credentials |
