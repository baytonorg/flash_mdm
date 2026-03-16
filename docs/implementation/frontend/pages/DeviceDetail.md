# `src/pages/DeviceDetail.tsx`

> Single-device detail page with tabbed views for overview, info, policy, applications, audit log, operations, location, and raw snapshot.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DeviceDetail` | `React.FC` (default) | Device detail page component |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `humanizeEnum` | 122-129 | Converts UPPER_SNAKE_CASE enum strings to Title Case |
| `describeNonCompliance` | 131-158 | Builds a human-readable description of a non-compliance detail object |
| `isDeviceTabKey` | 162-164 | Type guard validating a string is a valid tab key |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | Fetching device detail data |
| `getDeviceDisplayState` | `@/lib/device-state` | Deriving effective display state from snapshot `appliedState` (e.g., `LOST` from lost mode) |
| `StatusBadge` | `@/components/common/StatusBadge` | Rendering device state badges |
| `DeviceOverview` | `@/components/device/DeviceOverview` | Overview tab content |
| `DeviceInfo` | `@/components/device/DeviceInfo` | Hardware/software info tab |
| `DeviceAppInventory` | `@/components/device/DeviceAppInventory` | Installed applications tab |
| `DeviceAuditLog` | `@/components/device/DeviceAuditLog` | Device-specific audit log tab |
| `DeviceLocationHistory` | `@/components/device/DeviceLocationHistory` | Location history map tab |
| `DeviceRawSnapshot` | `@/components/device/DeviceRawSnapshot` | Raw AMAPI snapshot viewer tab |
| `DeviceOperations` | `@/components/device/DeviceOperations` | Device operations tab (pending ops) |
| `CommandModal` | `@/components/device/CommandModal` | Modal for issuing device commands |
| `ConfirmModal` | `@/components/common/ConfirmModal` | Confirmation dialog for destructive actions |
| `LivePageIndicator` | `@/components/common/LivePageIndicator` | Live-refresh status indicator |
| `PageLoadingState` | `@/components/common/PageLoadingState` | Full-page loading skeleton |
| `PolicyAssignmentSelect` | `@/components/policy/PolicyAssignmentSelect` | Changing the device's policy assignment |
| `PolicyOverrideEditor` | `@/components/policy/PolicyOverrideEditor` | Editing device-level policy overrides |
| `useDeleteDevice` | `@/api/queries/devices` | Device deletion mutation |
| `useAppFeedbackList` | `@/api/queries/app-feedback` | Loads keyed app feedback items for the current device |
| `groupAppFeedbackItems` | `@/components/device/appFeedbackGrouping` | Groups keyed feedback by package and computes app-level summary metadata |
| `useEffectivePolicy`, `useExternalPolicy`, `usePolicy` | `@/api/queries/policies` | Fetching policy data for the policy tab |
| `useGroups` | `@/api/queries/groups` | Fetching groups for group assignment |
| `usePolicyOverride` | `@/api/queries/policy-overrides` | Fetching device-level policy overrides |
| `useEnvironmentGuard` | `@/hooks/useEnvironmentGuard` | Redirecting if environment context is missing |
| `useContextStore` | `@/stores/context` | Accessing active environment/group context |

## Key Logic

The device display state is derived via `getDeviceDisplayState()` which prefers `snapshot.appliedState` over the top-level `state` field, enabling accurate display of states like `LOST`. The non-compliance section is labelled "Policy Exceptions". The page reads the device ID from the URL via `useParams` and fetches the full device detail payload (device metadata, applications, status reports, locations, audit log, and policy resolution) from the API. It supports 8 tabs controlled via URL search params: overview, info, policy, applications, audit, operations, location, and raw snapshot.

In the Applications tab, a collapsible **App Feedback** section appears above the installed app inventory. Feedback is grouped by app package (`package_name`) so high-volume keyed state feeds remain readable:

- One card per app package with app-level summary (`latest_reported_at`, highest severity, open count / total).
- Nested keyed entries inside each app card (`feedback_key`, message, status, per-item timestamp).
- Sorting prioritizes actionable data: apps with open feedback first, then newest updates.

The policy tab shows the full resolution chain (base policy, group/device overrides, derivative summary) and allows reassigning the policy or editing overrides. Device commands (lock, reboot, wipe, custom) are issued through `CommandModal`. The device can be deleted with confirmation. The page name and group assignment can be edited inline. Data auto-refreshes every 5 seconds. An environment guard redirects users if no environment is selected.
