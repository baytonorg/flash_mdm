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

The page fetches audit log entries for the active environment using `useAuditLog` with server-side filtering and pagination. It refreshes every 30 seconds. The selector uses the shared product action catalogue, including literal action families and specific current actions. Exact action mode accepts a bounded dotted product action and applies it only on submit; typing does not send searches. Arbitrary workflow-requested labels are not listed as product actions. The table displays action, target, actor/user, IP address, and a relative timestamp. A new environment remounts the page with initial pagination and filters. Filters reset pagination; paused, denied and failed requests retain the existing honest outcome handling. If no environment is selected, a placeholder message is shown.
