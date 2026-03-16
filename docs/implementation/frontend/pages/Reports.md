# `src/pages/Reports.tsx`

> Data export page for devices, policies, audit logs, and applications in CSV or JSON format.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Reports` | `React.FC` (default) | Reports and export page component |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useContextStore` | `@/stores/context` | Active environment access |
| `apiClient` | `@/api/client` | API calls for triggering exports |

## Key Logic

The page requires an active environment. It provides four export types -- devices, policies, audit log, and applications -- displayed as cards with icons and descriptions.

Users can select the export format (CSV or JSON) via a toggle. For audit log exports, an optional date range picker (from/to) is available.

Clicking "Export" on any card triggers a `POST /api/reports/export` mutation with the environment ID, export type, format, and optional date range. On success, the result (including export URL and record count) is added to a local `completedExports` list displayed as a "Recent Exports" section with download links.

Completed exports are cleared when the environment changes since export URLs are environment-specific. Error feedback is shown inline when an export fails.
