# `netlify/functions/component-assign.ts`

> Manages the assignment and unassignment of policy components to/from policies, and lists components assigned to a specific policy. Triggers policy recompilation after each change.

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
| `recompilePolicy` | `_lib/policy-recompile.js` | Recompile policy config after component changes |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp`, `getSearchParams` | `_lib/helpers.js` | HTTP response helpers and request parsing |

## Key Logic

### Assign (POST /assign)
1. Accepts `policy_id`, `component_id`, and optional `priority`.
2. Validates both the policy and component exist, and that they belong to the same environment.
3. Checks for duplicate assignment (returns 409 if already assigned).
4. If no priority is provided, auto-assigns `MAX(priority) + 1`.
5. Inserts into `policy_component_assignments` and triggers `recompilePolicy`.

### Unassign (POST /unassign)
1. Accepts `policy_id` and `component_id`.
2. Validates both exist and belong to the same environment.
3. Deletes the assignment row and triggers `recompilePolicy`.

### List (GET /policy/:policy_id)
1. Returns all components assigned to a policy, ordered by priority ascending.
2. Includes component details (`name`, `description`, `category`, `config_fragment`) and assignment metadata (`priority`, `assigned_at`).

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/component-assign` (action=`assign`) | Session | Assign a component to a policy |
| POST | `/.netlify/functions/component-assign` (action=`unassign`) | Session | Remove a component from a policy |
| GET | `/.netlify/functions/component-assign` (action=`policy/:policy_id`) | Session | List components assigned to a policy |
