# `netlify/functions/app-deploy.ts`

> Deploys an app to a specific scope (environment, group, or device) by upserting catalog, scope config, and legacy tables, then syncing affected AMAPI policies.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler (default export) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `transaction` | `_lib/db.js` | Database queries and transactional writes |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentPermission` | `_lib/rbac.js` | Environment-level RBAC enforcement |
| `logAudit` | `_lib/audit.js` | Audit trail logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP response builders, body parsing, IP extraction |
| `syncAffectedPoliciesToAmapi`, `selectPoliciesForDeploymentScope` | `_lib/deployment-sync.js` | AMAPI derivative policy sync |
| `AMAPI_APPLICATION_INSTALL_TYPES`, `isAmapiApplicationInstallType` | `_lib/amapi-application-policy.js` | Install type enum validation |

## Key Logic

The handler processes a single POST request to deploy an app to a scoped target:

1. **Validation**: Requires `environment_id`, `package_name`, `display_name`, `install_type`, `scope_type`, and `scope_id`. Validates `install_type` against the AMAPI allowed list and `scope_type` against `environment`, `group`, or `device`. For environment scope, `scope_id` must equal `environment_id`. For group/device scopes, verifies the target exists within the environment.

2. **Transaction** (Step 1): Within a single transaction, upserts three tables:
   - `apps` catalog entry (via `ON CONFLICT` on `environment_id, package_name`)
   - `app_scope_configs` scope-specific configuration (via `ON CONFLICT` on `app_id, scope_type, scope_id`)
   - `app_deployments` legacy table (via `ON CONFLICT` on `environment_id, package_name, scope_type, scope_id`)

   Then identifies all base policies affected by the deployment scope.

3. **AMAPI Sync** (Step 2): Calls `syncAffectedPoliciesToAmapi` to push updated derivative policies to Google AMAPI for all affected policies.

4. **Audit & Response**: Logs a detailed audit entry including sync results. Returns the created app and scope config IDs, plus AMAPI sync status. If sync partially fails, includes a warning message.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/apps/deploy | Session (write) | Deploy an app to a scope with full upsert and AMAPI sync |
