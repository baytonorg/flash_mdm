# `src/pages/Networks.tsx`

> Manages Wi-Fi (ONC) and APN network profile deployments scoped to environments, groups, or devices.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Networks` | `React.FC` (default) | Network deployment management page |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `Networks` | 51-949 | Main page component with deployment list, create/edit modal, and bulk actions |
| `WifiFormFields` | 951-999+ | Sub-component rendering Wi-Fi configuration form fields (SSID, security mode, EAP settings) |
| `ApnFormFields` | (after WifiFormFields) | Sub-component rendering APN configuration form fields (entry name, APN value, auth, proxy, protocol) |
| `buildStructuredWifiOncDoc` | 1369 | Constructs a structured ONC JSON document from Wi-Fi form state |
| `buildStructuredApnPolicy` | 1426 | Constructs a structured APN policy JSON document from APN form state |
| `validateOncJson` | 1484 | Validates raw JSON input as a valid ONC document with exactly one Wi-Fi entry |
| `validateApnPolicyJson` | 1498 | Validates raw JSON input as a valid APN policy with exactly one APN settings entry |
| `extractPrimaryWifiMeta` | 1512 | Extracts SSID, hidden, autoConnect metadata from an ONC document |
| `extractPrimaryApnMeta` | 1539 | Extracts APN name and metadata from an APN policy document |
| `readSecurityLabel` | 1567 | Returns a human-readable Wi-Fi security label from an ONC profile |
| `readWifiSsid` | 1573 | Extracts SSID string from an ONC profile |
| `inferDeploymentKind` | 1587 | Determines whether a deployment is Wi-Fi or APN based on explicit type and profile shape |
| `readApnSummary` | 1599 | Extracts summary information (APN name, types, override mode) from a stored profile |
| `extractWifiFormFields` | 1625 | Reverse-maps a stored ONC profile back into individual form field values |
| `extractApnFormFields` | 1678 | Reverse-maps a stored APN policy back into individual form field values |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useContextStore` | `@/stores/context` | Active environment access |
| `AppScopeSelector` | `@/components/apps/AppScopeSelector` | Scope picker (environment/group/device) |
| `useDeployNetwork`, `useNetworkDeployments`, `useUpdateNetworkDeployment`, `useDeleteNetworkDeployment`, `useBulkNetworkAction` | `@/api/queries/networks` | CRUD and bulk operations for network deployments |
| `NetworkDeployment` (type) | `@/api/queries/networks` | TypeScript type for deployment records |
| `BulkActionBar`, `BulkAction` (type) | `@/components/common/BulkActionBar` | Floating bulk action toolbar |
| `SelectAllMatchingNotice` | `@/components/common/SelectAllMatchingNotice` | "Select all matching" notice banner |
| `useBulkSelection` | `@/hooks/useBulkSelection` | Checkbox selection state management |

## Key Logic

The page requires an active environment to display content. It fetches all network deployments for the current environment and renders them in a list with badges indicating scope type, network type (Wi-Fi/APN), security mode, and hidden SSID status.

Users can create new network profiles or edit existing ones via a modal dialog. The modal supports two network kinds -- Wi-Fi (ONC) and APN -- and two editor modes -- form and JSON override. In form mode, the component builds a structured ONC or APN policy document from individual form fields using `buildStructuredWifiOncDoc` or `buildStructuredApnPolicy`, with a live JSON preview. In JSON override mode, users can paste or edit raw JSON directly, validated by `validateOncJson` or `validateApnPolicyJson`.

When editing an existing deployment, the stored profile is reverse-mapped into form fields using `extractWifiFormFields` or `extractApnFormFields`. The scope cannot be changed after initial deployment.

Deployments can be deleted individually (with inline confirmation) or in bulk via the `BulkActionBar`. After create/update/delete, the component displays an AMAPI sync summary showing how many policies were synced, failed, or skipped.

State resets automatically when the active environment changes.
