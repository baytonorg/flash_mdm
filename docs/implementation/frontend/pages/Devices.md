# `src/pages/Devices.tsx`

> Paginated device list with filtering, sorting, row selection, and bulk actions.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Devices` | `React.FC` (default) | Devices list page component |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `formatRelativeTime` | 47-60 | Converts a date string to a relative time label (e.g. "3h ago") |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | Fetching device list |
| `useContextStore` | `@/stores/context` | Accessing active environment and group |
| `DataTable`, `ColumnDef` | `@/components/common/DataTable` | Rendering the device table |
| `FilterBar` | `@/components/common/FilterBar` | Search and dropdown filter controls |
| `Pagination` | `@/components/common/Pagination` | Page navigation |
| `BulkActionBar`, `BulkAction` | `@/components/common/BulkActionBar` | Bulk action toolbar for selected devices |
| `StatusBadge` | `@/components/common/StatusBadge` | State and ownership badge rendering |
| `LivePageIndicator` | `@/components/common/LivePageIndicator` | Live-refresh status indicator |
| `CommandModal` | `@/components/device/CommandModal` | Modal for issuing bulk device commands |

## Key Logic

The page fetches a paginated device list from `/api/devices/list` with server-side filtering (search text, state, ownership, manufacturer, compliance), sorting, and pagination. It auto-refreshes every 5 seconds. The table columns display device name, serial number, manufacturer, model, OS version, state, ownership, compliance status, and last-seen time. Clicking a row navigates to the device detail page. Rows are selectable for bulk operations; the bulk action bar supports Lock, Reboot, Wipe, Delete, and a "More..." option that opens a `CommandModal` targeting all selected devices. Filter and sort state resets when the environment or group context changes. Manufacturer filter options are derived dynamically from the loaded device list.
