# `src/api/queries/app-feedback.ts`

> React Query hooks for app feedback item listing from AMAPI keyed app state.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `AppFeedbackItem` | `interface` | Feedback item shape: id, environment_id, device_id, package_name, feedback_key, severity, message, data_json, timestamps, status |
| `appFeedbackKeys` | `object` | Query key factory: `all`, `list(environmentId, filterKey)` |
| `useAppFeedbackList` | `(filters) => UseQueryResult` | Fetches feedback items for an environment with optional filters |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | HTTP requests |
