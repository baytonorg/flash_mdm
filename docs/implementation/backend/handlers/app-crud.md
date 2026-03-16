# `netlify/functions/app-crud.ts`

> Multi-route handler for app catalog management, scope-based configuration, and legacy deployment CRUD with AMAPI policy sync.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler (default export) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `parseJson` | 77-82 | Safely parses a JSON string or returns the value as-is; returns `{}` on failure |
| `validateInstallTypeField` | 84-90 | Validates an install type value against the AMAPI allowed list |
| `validateAppPolicyField` | 92-99 | Validates an app_policy object against the AMAPI application policy fragment schema |
| `getAmapiAppMetadataContext` | 101-109 | Fetches workspace and enterprise details needed for AMAPI app metadata calls |
| `fetchAmapiAppMetadata` | 111-137 | Calls AMAPI to retrieve app title and icon URL for a given package name |
| `hydrateAppMetadataCache` | 139-167 | Lazily hydrates an app row's display_name and icon_url from AMAPI if missing, persisting back to DB |
| `handleCatalog` | 246-291 | Lists all imported apps for an environment with hydrated metadata and scope config counts |
| `handleImport` | 295-346 | Imports (upserts) an app into the catalog for an environment |
| `handleGetApp` | 350-389 | Retrieves a single app by UUID with all its scope configurations and resolved scope names |
| `handleUpdateApp` | 393-448 | Updates app default settings and triggers AMAPI policy sync for affected policies |
| `handleDeleteApp` | 452-500 | Deletes an app and its scope configs (cascade), cleans up legacy table, syncs AMAPI |
| `handleAddScopeConfig` | 504-599 | Adds or upserts a scope-specific config for an app (also syncs legacy app_deployments table) |
| `handleUpdateScopeConfig` | 603-693 | Updates an existing scope config and syncs both new and legacy tables, then triggers AMAPI sync |
| `handleDeleteScopeConfig` | 697-753 | Deletes a scope config from both new and legacy tables, then triggers AMAPI sync |
| `handleLegacyGet` | 757-774 | Backward-compatible GET for legacy app_deployments by deployment ID |
| `handleLegacyUpdate` | 776-871 | Backward-compatible PUT for legacy app_deployments, also syncs new app_scope_configs table |
| `handleLegacyDelete` | 873-935 | Backward-compatible DELETE for legacy app_deployments, also cleans new app_scope_configs table |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `transaction` | `_lib/db.js` | Database operations and transactional writes |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentPermission` | `_lib/rbac.js` | Environment-level RBAC enforcement |
| `logAudit` | `_lib/audit.js` | Audit trail logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getSearchParams`, `getClientIp` | `_lib/helpers.js` | HTTP response builders, body parsing, query params, IP extraction |
| `syncAffectedPoliciesToAmapi`, `selectPoliciesForDeploymentScope` | `_lib/deployment-sync.js` | AMAPI derivative policy sync after deployments change |
| `amapiCall`, `getAmapiErrorHttpStatus` | `_lib/amapi.js` | Google AMAPI HTTP calls and error status extraction |
| `AMAPI_APPLICATION_INSTALL_TYPES`, `isAmapiApplicationInstallType`, `validateAmapiApplicationPolicyFragment` | `_lib/amapi-application-policy.js` | Install type enum validation and app policy fragment validation |
| `mergeHydratedAppMetadata`, `needsAppMetadataHydration` | `_lib/app-metadata-cache.js` | Logic for determining when app metadata needs AMAPI hydration and merging results |

## Key Logic

The handler implements a custom URL-based router that splits the path after `/api/apps/` into segments to dispatch across two API surfaces:

**New API (apps + app_scope_configs tables):**
- **Catalog** lists all imported apps for an environment with lazy AMAPI metadata hydration (fetches title/icon from Google Play if missing).
- **Import** upserts an app into the catalog using an `ON CONFLICT` on `(environment_id, package_name)`.
- **App CRUD by UUID** supports GET (with all scope configs and resolved scope names), PUT (update defaults), and DELETE (cascading delete).
- **Scope config CRUD** allows adding, updating, and deleting per-scope (environment/group/device) overrides for install type, auto update mode, managed config, and app_policy.

**Legacy API (app_deployments table):**
- GET/PUT/DELETE on `/api/apps/deployments/:id` for backward compatibility.
- Legacy writes are dual-synced: changes flow to both `app_deployments` and `app_scope_configs` tables.

All write operations trigger `syncAffectedPoliciesToAmapi` to push updated policy payloads to Google AMAPI. Deletions use transactions to identify affected policies before removing rows. Audit logging tracks imports, deletions, and scope config changes.

When a segment is a non-UUID string, the handler forwards to `app-details.ts` via dynamic import for package-name-based lookups.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /api/apps/catalog?environment_id= | Session (read) | List imported apps for an environment |
| POST | /api/apps/import | Session (write) | Import/upsert an app into the catalog |
| GET | /api/apps/:id | Session (read) | Get app by UUID with scope configs |
| PUT | /api/apps/:id | Session (write) | Update app default settings |
| DELETE | /api/apps/:id | Session (write) | Delete an app and all scope configs |
| POST | /api/apps/:id/configs | Session (write) | Add a scope config to an app |
| PUT | /api/apps/:id/configs/:configId | Session (write) | Update a scope config |
| DELETE | /api/apps/:id/configs/:configId | Session (write) | Delete a scope config |
| GET | /api/apps/deployments/:id | Session (read) | Legacy: get deployment by ID |
| PUT | /api/apps/deployments/:id | Session (write) | Legacy: update deployment |
| DELETE | /api/apps/deployments/:id | Session (write) | Legacy: delete deployment |
| GET | /api/apps/:packageName | Session (read) | Proxy to app-details for package name lookups |
