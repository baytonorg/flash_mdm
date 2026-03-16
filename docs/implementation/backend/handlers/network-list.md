# `netlify/functions/network-list.ts`

> Lists all network deployments (WiFi and APN) for an environment with normalized profiles and inferred network types.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler (default export) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `safeParseJson` | 64-70 | Safely parses a JSON string, returning a typed fallback on failure |
| `normalizeStoredProfile` | 72-75 | Converts a stored profile value (string or object) into a consistent object |
| `inferNetworkType` | 77-84 | Determines if a stored profile is WiFi or APN based on presence of `NetworkConfigurations` vs `apnPolicy`/`kind` fields |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne` | `_lib/db.js` | Database queries |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentPermission` | `_lib/rbac.js` | Environment-level RBAC enforcement |
| `jsonResponse`, `errorResponse`, `getSearchParams` | `_lib/helpers.js` | HTTP response builders and query param extraction |

## Key Logic

The handler lists all network deployments for a given environment:

1. Requires `environment_id` query parameter. Verifies the environment exists and enforces read permission.
2. Queries all rows from `network_deployments` for the environment, ordered by `created_at DESC`.
3. For each row:
   - Normalizes the `onc_profile` from JSON string to object using `normalizeStoredProfile`.
   - Infers the `network_type` if not already stored in the DB column, by inspecting the profile structure (presence of `NetworkConfigurations` indicates WiFi; `apnPolicy` or `kind: 'apnPolicy'` indicates APN).
4. Returns the full list of deployments with all fields.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /.netlify/functions/network-list?environment_id= | Session (read) | List all network deployments for an environment |
