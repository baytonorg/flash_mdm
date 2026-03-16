# `src/api/queries/licenses.ts`

> React Query hooks for checking license status, creating Stripe checkout sessions, and assigning/unassigning device licenses.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `LicensePlan` | `interface` | Plan definition with name, max_devices, and features |
| `License` | `interface` | License record with stripe subscription id, status, period end |
| `LicenseStatusResponse` | `interface` | Comprehensive license status: plan, device count/limit, usage %, Stripe enabled, per-environment breakdown, overage tracking, workspace licensing settings |
| `licenseKeys` | `object` | Query key factory: `all` and `status({workspaceId, environmentId})` |
| `useLicenseStatus` | `(scope: {workspaceId?, environmentId?}) => UseQueryResult<LicenseStatusResponse>` | Fetches license status scoped to workspace or environment |
| `useCreateCheckout` | `() => UseMutationResult` | Creates a Stripe checkout session and redirects the browser to the checkout URL |
| `useAssignLicense` | `() => UseMutationResult` | Assigns a license seat to a device |
| `useUnassignLicense` | `() => UseMutationResult` | Unassigns a license seat from a device |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- `useLicenseStatus` can be scoped to either a workspace or an environment; the query string switches accordingly.
- `useCreateCheckout` redirects the browser to `data.checkout_url` on success (side-effect in `onSuccess`).
- The `LicenseStatusResponse` includes detailed overage tracking per environment: `overage_phase` progresses through `warn` -> `block` -> `disable` -> `wipe` -> `resolved` based on configurable grace day thresholds.
- `workspace_licensing_settings` exposes the full licensing configuration including billing method, free tier settings, and grace day configuration.
