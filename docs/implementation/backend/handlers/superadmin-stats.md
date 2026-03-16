# `netlify/functions/superadmin-stats.ts`

> Superadmin dashboard statistics endpoint providing platform-wide counts, device distribution by plan, recent signups, PubSub event logs, and derivative policy decision history.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `handler` | `(request: Request, context: Context) => Promise<Response>` | Default-exported Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `parseJsonObject` | 7-24 | Safely parses a value (string or object) into a `Record<string, unknown>`, returning null on failure |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `requireSuperadmin` | `_lib/auth` | Superadmin authentication gate |
| `queryOne`, `query` | `_lib/db` | Database queries |
| `getBlobJson` | `_lib/blobs` | Retrieving raw PubSub event payloads from blob storage |
| `jsonResponse`, `errorResponse` | `_lib/helpers` | Response utilities |

## Key Logic

GET-only endpoint. Aggregates multiple database queries:

1. **Totals:** Counts of workspaces, environments, devices, and users.
2. **Devices by plan:** Groups device counts by license plan name (LEFT JOINs through environments, licenses, and license_plans).
3. **Recent signups:** Daily workspace creation counts over the last 30 days.
4. **PubSub event log:** Last 15 PubSub events with optional raw payload preview fetched from blob storage. Blob fetch failures are silently ignored to keep the endpoint resilient.
5. **Derivative policy decisions:** Last 30 audit log entries where `action = 'policy.derivative_decision'`, enriched with workspace/environment/device metadata. Extracts structured fields from the audit `details` JSON.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/.netlify/functions/superadmin-stats` | Superadmin | Returns platform-wide statistics and recent event logs |
