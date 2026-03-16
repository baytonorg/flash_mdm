# `netlify/functions/component-crud.ts`

> CRUD handler for policy components: list, get, create, update, and delete. Automatically recompiles all affected policies when a component's `config_fragment` changes.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute` | `_lib/db.js` | Database operations |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentResourcePermission` | `_lib/rbac.js` | Environment-level RBAC check |
| `logAudit` | `_lib/audit.js` | Audit log entries |
| `recompilePolicy` | `_lib/policy-recompile.js` | Recompile affected policies after component config changes |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp`, `getSearchParams` | `_lib/helpers.js` | HTTP response helpers and request parsing |

## Key Logic

### List (GET /list)
- Returns all components for an environment, ordered by `category` then `name`.
- Requires `policy:read` permission.

### Get (GET /:id)
- Returns a single component by ID.
- The route matches any segment that is not a reserved action keyword (`list`, `create`, `update`, `assign`, `unassign`, `policy`).
- Requires `policy:read` permission on the component's environment.

### Create (POST /create)
- Accepts `environment_id`, `name`, `category`, and `config_fragment`.
- Generates a UUID, inserts the component row, and logs an audit entry.
- Returns the new component with `201 Created`.

### Update (PUT /update)
- Accepts `id` and optional fields: `name`, `description`, `category`, `config_fragment`.
- Uses `COALESCE` to only update provided fields.
- If `config_fragment` is updated, finds all policies using this component via `policy_component_assignments` and recompiles each one. Reports any recompilation failures in the response.

### Delete (DELETE /:id)
- Fetches affected policies before deletion.
- Removes all `policy_component_assignments` for the component, then deletes the component row.
- Recompiles all affected policies (best-effort; failures are logged but non-fatal).

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/.netlify/functions/component-crud` (action=`list`) | Session | List all components for an environment |
| GET | `/.netlify/functions/component-crud` (action=`:id`) | Session | Get a single component by ID |
| POST | `/.netlify/functions/component-crud` (action=`create`) | Session | Create a new component |
| PUT | `/.netlify/functions/component-crud` (action=`update`) | Session | Update a component |
| DELETE | `/.netlify/functions/component-crud` (action=`:id`) | Session | Delete a component |
