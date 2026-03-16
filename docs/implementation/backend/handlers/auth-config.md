# `netlify/functions/auth-config.ts`

> Returns public authentication configuration settings (e.g. whether registration is invite-only).

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `getPlatformSettings` | `_lib/platform-settings.js` | Fetches platform-level settings from the database |
| `errorResponse`, `jsonResponse` | `_lib/helpers.js` | Standardised HTTP response builders |

## Key Logic

1. Rejects non-GET requests with 405.
2. Loads platform settings via `getPlatformSettings()`.
3. Returns `{ invite_only_registration }` from those settings.
4. On error, falls back to `{ invite_only_registration: false, fallback: true }` so the client can still render a registration form.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/.netlify/functions/auth-config` | None | Retrieve public auth configuration |
