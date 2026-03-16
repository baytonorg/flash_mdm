# `src/pages/AuditLog.tsx`

> Paginated audit log viewer with action-type filtering and live refresh.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `AuditLog` | `React.FC` (default) | Audit log page component |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `timeAgo` | 11-27 | Converts a date string to a human-readable relative time (e.g. "5m ago") |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useContextStore` | `@/stores/context` | Accessing active environment |
| `useAuditLog`, `AuditEntry` | `@/api/queries/audit` | Fetching paginated audit log entries |
| `DataTable`, `ColumnDef` | `@/components/common/DataTable` | Rendering the log entries table |
| `Pagination` | `@/components/common/Pagination` | Page navigation controls |
| `LivePageIndicator` | `@/components/common/LivePageIndicator` | Showing live-refresh status indicator |

## Key Logic

The page fetches audit log entries for the active environment using `useAuditLog` with server-side pagination. It auto-refreshes every 5 seconds via the query's `refetchInterval`. A client-side action filter dropdown (populated from the `ACTION_TYPES` constant covering device, policy, group, user, environment, workspace, and auth actions) narrows the displayed entries. The table displays action, target, actor/user, IP address, and a relative timestamp. Pagination resets when the environment changes or the action filter is modified. If no environment is selected, a placeholder message is shown.
