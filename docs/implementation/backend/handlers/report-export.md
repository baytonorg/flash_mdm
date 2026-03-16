# `netlify/functions/report-export.ts`

> Generates and stores data exports (devices, policies, audit logs, apps) in CSV or JSON format for later download.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `handler` | `(request: Request, context: Context) => Promise<Response>` | Default-exported Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `generateExportData` | 104-212 | Queries the appropriate table based on export type, with group-scoped filtering for devices and date range filtering for audit logs |
| `convertToCsv` | 214-233 | Converts an array of objects to CSV string with proper escaping |
| `sanitizeCsvCell` | 235-238 | Prevents CSV injection by prefixing cells that start with `=`, `+`, `-`, `@`, tab, or carriage return |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `requireAuth` | `_lib/auth` | Authentication |
| `requireEnvironmentAccessScopeForPermission` | `_lib/rbac` | Environment access scope enforcement with group filtering |
| `query`, `queryOne` | `_lib/db` | Database queries |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers` | Request/response utilities |
| `storeBlob` | `_lib/blobs` | Storing export files |
| `logAudit` | `_lib/audit` | Audit logging |

## Key Logic

POST-only endpoint. Accepts a body with `environment_id`, `type` (devices, policies, audit, apps), `format` (csv, json), and optional `date_from`/`date_to` for audit exports.

**Export types:**
- **devices** -- All non-deleted devices with full metadata, group-filtered for scoped users.
- **policies** -- All policies in the environment.
- **audit** -- Audit log entries (up to 10,000) with optional date range filtering, joined with user emails.
- **apps** -- App deployments in the environment.

**Group scoping:** Uses `requireEnvironmentAccessScopeForPermission` with `write` level. For scoped users, the device query adds a `group_id = ANY($3)` filter.

**Storage and response:** Generates a UUID export ID, stores the formatted content to blob storage at `exports/{workspace_id}/{export_id}.{format}`, and returns a download URL pointing to the `report-download` endpoint.

**CSV security:** The `sanitizeCsvCell` function prevents formula injection attacks by prefixing dangerous characters with a single quote.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/.netlify/functions/report-export` | Session or API key | Generate and store a data export, returning a download URL |
