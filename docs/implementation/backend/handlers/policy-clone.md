# `netlify/functions/policy-clone.ts`

> Clones an existing policy into a new draft policy, copying its config, metadata, component assignments, and creating an initial version record.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute`, `transaction` | `_lib/db.js` | Database operations |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentResourcePermission` | `_lib/rbac.js` | Environment-level RBAC check |
| `logAudit` | `_lib/audit.js` | Audit log entries |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP response helpers and request parsing |

## Key Logic

1. Accepts `policy_id` (source) and `new_name` for the clone.
2. Fetches the source policy; verifies it exists.
3. Requires `policy:write` permission on the source policy's environment.
4. Within a transaction:
   - Creates a new policy row with status `draft` and version `1`.
   - Inserts an initial `policy_versions` record with change summary noting the clone source.
   - Copies all `policy_component_assignments` from the source policy to the new policy, preserving priority order.
5. Logs an audit entry (`policy.cloned`) with source and target details.
6. Returns the new policy object with `201 Created`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/policy-clone` (action=`clone`) | Session | Clone a policy into a new draft |
