# `netlify/functions/dashboard-data.ts`

> Environment dashboard data endpoint providing device statistics, compliance rates, distribution breakdowns, enrollment trends, and recent audit events.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Default-exported Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne` | `_lib/db` | Database queries |
| `requireAuth` | `_lib/auth` | Authentication |
| `requireEnvironmentAccessScopeForPermission` | `_lib/rbac` | Environment access scope enforcement (full or group-scoped) |
| `jsonResponse`, `errorResponse`, `getSearchParams` | `_lib/helpers` | Response utilities |

## Key Logic

GET-only endpoint. Requires `environment_id` query parameter. Uses `requireEnvironmentAccessScopeForPermission` to determine if the caller has full environment access or group-scoped access.

**Group-scoped users:** When the caller has `mode: 'group'` access, all device queries are filtered by `group_id = ANY($2::uuid[])`. If no groups are accessible, returns an empty dashboard with zero counts. Policy count, enrollment token count, and audit events are also scoped accordingly.

**Parallel queries:** All 12 dashboard queries run in parallel via `Promise.all` for performance:
1. Devices by state
2. Devices by ownership
3. Devices by management mode
4. Devices by manufacturer (top 10)
5. Devices by OS version (top 10)
6. Devices by security patch level (top 10)
7. Policy count (0 for group-scoped users)
8. Enrollment token count (0 for group-scoped users)
9. Compliance stats (compliant vs non-compliant among ACTIVE devices)
10. Enrollment trend (daily counts over last 30 days)
11. Recent audit events (last 10)
12. Total device count

**Compliance rate:** Calculated as `compliant / (compliant + non_compliant) * 100`, rounded to two decimal places.

**Response:** Returns both a primary shape (flat fields like `device_count`, `compliance_rate`, distribution maps) and backwards-compatible fields (`total_devices`, `compliance` object).

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/.netlify/functions/dashboard-data` | Session or API key | Returns environment dashboard statistics |
