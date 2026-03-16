# `src/api/queries/apps.ts`

> React Query hooks for searching, deploying, and managing Android apps, including both the new catalog/scope-config model and the legacy deployment model.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `AppSearchResult` | `interface` | Minimal app info returned from Play search (package_name, title, icon_url) |
| `ManagedProperty` | `interface` | Managed configuration property schema for an app |
| `AppDetail` | `interface` | Full app detail including permissions, managed properties, and app tracks |
| `AppDeployment` | `interface` | Legacy deployment record (backward compat) |
| `CatalogApp` | `interface` | New app catalog entry with defaults and scope config count |
| `AppScopeConfig` | `interface` | Per-scope app configuration (install type, managed config, app policy) |
| `WebToken` | `interface` | Managed Google Play web token for iframe embedding |
| `appKeys` | `object` | Query key factory for search, detail, deployments, catalog, app, webToken |
| `useAppSearch` | `(environmentId, query) => UseQueryResult<AppSearchResult[]>` | Searches apps; enabled when query >= 2 chars |
| `useAppDetails` | `(environmentId, packageName) => UseQueryResult<AppDetail>` | Fetches full app detail from AMAPI |
| `useAppCatalog` | `(environmentId) => UseQueryResult<CatalogApp[]>` | Lists all catalog apps for an environment |
| `useApp` | `(appId) => UseQueryResult<{app, scope_configs}>` | Fetches a single app with all its scope configs |
| `useDeployApp` | `() => UseMutationResult` | Deploys an app (creates catalog entry + scope config); invalidates catalog, deployments, policies, devices |
| `useImportApp` | `() => UseMutationResult` | Imports an app to catalog without creating a scope config |
| `useAddAppScopeConfig` | `() => UseMutationResult` | Adds a scope config to an existing catalog app |
| `useUpdateAppScopeConfig` | `() => UseMutationResult` | Updates an existing scope config |
| `useDeleteAppScopeConfig` | `() => UseMutationResult` | Deletes a scope config from an app |
| `useDeleteApp` | `() => UseMutationResult` | Deletes an entire catalog app and all its scope configs |
| `useUpdateApp` | `() => UseMutationResult` | Updates app-level defaults (display name, install type, auto update, managed config) |
| `useUpdateAppDeployment` | `() => UseMutationResult` | Legacy: updates a deployment record |
| `useDeleteAppDeployment` | `() => UseMutationResult` | Legacy: deletes a deployment record |
| `useAppWebToken` | `() => UseMutationResult<WebToken>` | Generates a managed Google Play web token for iframe embedding |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | HTTP requests |

## Key Logic

- Two parallel app models coexist: the new **catalog + scope config** model (`CatalogApp` / `AppScopeConfig`) and the **legacy deployment** model (`AppDeployment`).
- Deploy, add/update/delete scope configs, and delete app mutations all aggressively invalidate `policies` and `devices` caches because app changes propagate to AMAPI policies.
- `useAppSearch` requires a minimum 2-character query to enable the request.
- `useAppWebToken` is a mutation (not a query) since tokens are single-use and should not be cached.
