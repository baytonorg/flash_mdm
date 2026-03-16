# `netlify/functions/superadmin-settings.ts`

> Superadmin endpoint for reading and updating platform-wide settings (invite-only registration, licensing toggles, default free tier configuration).

## Exports

| Name | Type | Description |
|------|------|-------------|
| `handler` | `(request: Request, context: Context) => Promise<Response>` | Default-exported Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `requireSuperadmin` | `_lib/auth` | Superadmin authentication gate |
| `getPlatformSettings`, `setPlatformSettings` | `_lib/platform-settings` | Read/write singleton platform settings |
| `getClientIp`, `jsonResponse`, `errorResponse`, `parseJsonBody` | `_lib/helpers` | Request/response utilities |
| `logAudit` | `_lib/audit` | Audit logging |

## Key Logic

**GET:** Returns the full platform settings object (invite_only_registration, licensing_enabled, default_free_enabled, default_free_seat_limit).

**POST:** Accepts a partial update body. At least one setting field must be provided. Validates `default_free_seat_limit` as an integer between 0 and 1,000,000. Calls `setPlatformSettings` with only the provided fields, then re-reads and returns the full updated settings. Logs the update to the audit trail.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/.netlify/functions/superadmin-settings` | Superadmin | Retrieve current platform settings |
| `POST` | `/.netlify/functions/superadmin-settings` | Superadmin | Update one or more platform settings |
