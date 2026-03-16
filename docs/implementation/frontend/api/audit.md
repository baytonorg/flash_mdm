# `src/api/queries/audit.ts`

> React Query hook for fetching paginated audit log entries for an environment, with automatic 5-second polling.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `AuditEntry` | `interface` | Shape of an audit log entry (id, action, actor, target, details, timestamps) |
| `AuditListParams` | `interface` | Query parameters: `environment_id`, optional `page` and `per_page` |
| `auditKeys` | `object` | Query key factory with `all` and `list(params)` |
| `useAuditLog` | `(params: AuditListParams) => UseQueryResult<{entries, total}>` | Fetches audit log with pagination; polls every 5 seconds including in background |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `buildAuditQuery` | 37-43 | Builds URLSearchParams string from `AuditListParams` |

## Key Logic

- Polling is set to `refetchInterval: 5000` with `refetchIntervalInBackground: true` so audit logs stay live even when the tab is not focused.
- The response includes `entries` array and `total` count for pagination.
