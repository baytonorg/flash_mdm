# `netlify/functions/policy-versions.ts`

> Read-only handler for listing policy version history and retrieving a specific version's config snapshot.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne` | `_lib/db.js` | Database queries |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentResourcePermission` | `_lib/rbac.js` | Environment-level RBAC check |
| `jsonResponse`, `errorResponse` | `_lib/helpers.js` | HTTP response helpers |

## Key Logic

1. Parses path segments to extract `policyId` and optional `versionNumber` from `/api/policies/:id/versions[/:version]`.
2. Only GET requests are allowed (returns 405 for other methods).
3. Verifies the policy exists and checks `policy:read` permission on its environment.
4. **List versions** (`GET /:id/versions`): Returns all versions ordered by version number descending, with `change_summary`, `created_at`, and `changed_by_email` (joined from `users`).
5. **Get version** (`GET /:id/versions/:version`): Returns the full config snapshot for a specific version number, including `changed_by_email`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/.netlify/functions/policy-versions` (path=`:id/versions`) | Session | List all versions of a policy |
| GET | `/.netlify/functions/policy-versions` (path=`:id/versions/:version`) | Session | Get the config snapshot for a specific version |
