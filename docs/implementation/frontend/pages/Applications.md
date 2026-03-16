# `src/pages/Applications.tsx`

> Application management page for searching, importing, deploying, and configuring Android apps within an environment.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Applications` | `React.FC` (default) | Page component for managing applications |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `formatInstallTypeLabel` | 53-55 | Converts install type enum values to human-readable labels |
| `formatScopeTypeLabel` | 57-59 | Capitalises the first letter of a scope type string |
| `formatAutoUpdateLabel` | 61-64 | Converts auto-update mode enum to a friendly label |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | Direct API calls |
| `useContextStore` | `@/stores/context` | Accessing active environment |
| `useAppSearch`, `useAppDetails`, `useDeployApp`, `useUpdateAppDeployment`, `useDeleteAppDeployment`, `useAppWebToken`, `useAppCatalog`, `useApp`, `useImportApp`, `useDeleteApp`, `useAddAppScopeConfig`, `useUpdateAppScopeConfig`, `useDeleteAppScopeConfig` | `@/api/queries/apps` | App CRUD and deployment mutations/queries |
| `AppSearchResult`, `AppDeployment`, `CatalogApp`, `AppScopeConfig` | `@/api/queries/apps` | TypeScript types for app data |
| `PlayStoreIframe` | `@/components/apps/PlayStoreIframe` | Embedded managed Google Play iframe |
| `ManagedConfigEditor` | `@/components/apps/ManagedConfigEditor` | Editing managed configuration for apps |
| `AppScopeSelector` | `@/components/apps/AppScopeSelector` | Selecting deployment scope (environment/group/device) |
| `AmapiApplicationPolicyEditor` | `@/components/apps/AmapiApplicationPolicyEditor` | Editing AMAPI application policy fields |
| `JsonField` | `@/components/policy/fields/JsonField` | JSON editing for managed config |

## Key Logic

The page provides a full application lifecycle management interface. It fetches the app catalog for the active environment and allows searching Google Play via `useAppSearch` with debounced input. Users can select an app to view its details in a side panel (`useAppDetails`), import apps into the local catalog (`useImportApp`), and deploy them to scopes (environment, group, or device) with configurable install type and auto-update mode. A managed configuration editor supports per-app config. The Play Store iframe can be opened via a web token (`useAppWebToken`) for browsing and approving apps. Existing deployments can be edited or deleted. App scope configs allow granular per-scope AMAPI application policy overrides. Constants `INSTALL_TYPES` and `AUTO_UPDATE_MODES` define the available enum options for deployment configuration.
