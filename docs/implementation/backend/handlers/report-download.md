# `netlify/functions/report-download.ts`

> Serves previously exported report files (CSV or JSON) from blob storage as downloadable attachments.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `handler` | `(request: Request, context: Context) => Promise<Response>` | Default-exported Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `requireAuth` | `_lib/auth` | Authentication |
| `requireWorkspacePermission` | `_lib/rbac` | Workspace-level write permission check |
| `queryOne` | `_lib/db` | Database queries (imported but not directly used in main flow) |
| `getBlob` | `_lib/blobs` | Retrieving export files from blob storage |
| `logAudit` | `_lib/audit` | Audit logging the download |
| `errorResponse`, `getClientIp`, `getSearchParams` | `_lib/helpers` | Response utilities |

## Key Logic

GET-only endpoint. Requires three query parameters: `id` (export ID), `workspace_id`, and `format` (csv or json).

1. Validates format is `csv` or `json`.
2. Checks workspace write permission.
3. Retrieves the blob at `exports/{workspace_id}/{id}.{format}`.
4. Returns 404 if the blob is not found.
5. Logs a `report.downloaded` audit event.
6. Returns the file content with appropriate `Content-Type` and `Content-Disposition: attachment` headers. Sets `Cache-Control: private, max-age=60`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/.netlify/functions/report-download` | Session or API key | Download an exported report file |
