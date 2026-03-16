# `netlify/functions/group-crud.ts`

> Full CRUD and bulk operations for device groups, including hierarchical group management with closure table maintenance.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `buildNestedGroupList` | 16-34 | Recursively builds a depth-annotated flat list from a parent-child group structure for tree rendering |
| `performGroupMove` | 467-575 | Moves a group to a new parent, updating the closure table in a transaction; optionally clears direct policy/app/network assignments |
| `performGroupDelete` | 577-674 | Deletes a group and all its descendants, unassigns devices, cleans up deployments/assignments/derivatives, and re-syncs affected devices to their new effective policy via AMAPI |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute`, `transaction` | `_lib/db.js` | Database reads, writes, and transactional operations |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentResourcePermission`, `requireEnvironmentAccessScopeForResourcePermission` | `_lib/rbac.js` | Per-environment RBAC and group-scoped access enforcement |
| `logAudit` | `_lib/audit.js` | Audit trail logging |
| `getPolicyAmapiContext`, `assignPolicyToDeviceWithDerivative` | `_lib/policy-derivatives.js` | AMAPI context resolution and device policy re-assignment after group deletion |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp`, `getSearchParams`, `isValidUuid` | `_lib/helpers.js` | HTTP response helpers, body/query parsing, UUID validation |

## Key Logic

The handler routes on HTTP method and URL path action segment (`/api/groups/{action}`):

**GET action=list** -- Lists all groups for an environment:
- Joins with `policy_assignments` to include each group's assigned policy.
- Respects group-scoped access: if the user only has access to specific groups, filters accordingly and detaches parent references to inaccessible groups.
- Returns groups as a nested (depth-annotated) flat list via `buildNestedGroupList`.

**GET action=descendants** -- Lists all descendants of a group:
- Uses `group_closures` to find all descendants with depth > 0.
- Respects group-scoped access.

**POST action=create** -- Creates a new group:
- Validates parent group exists in the same environment (if provided).
- In a transaction: inserts the group row, creates the self-link closure entry (depth 0), propagates closure rows from all ancestors of the parent, and adds the creator as an admin group member.

**PUT action=update** -- Updates group name, description, or parent:
- Detects parent changes and validates: no self-parenting, same environment, and no cycles (via closure table check).
- On parent change, executes a transaction that removes old ancestor-to-subtree closure paths and inserts new ones using a cross-join of the new parent's ancestors with the subtree's internal closures.

**POST action=bulk** -- Bulk delete or move operations:
- **delete**: Identifies root groups in the selection (those without a selected ancestor), deletes each root and its full subtree via `performGroupDelete`, and marks descendants as covered.
- **move**: Moves each selected group to a new parent via `performGroupMove`; optionally clears direct assignments.

**DELETE /{groupId}** -- Deletes a single group and its descendants:
- Delegates to `performGroupDelete`, which: nullifies `group_id` on affected devices, removes all group-scoped deployments/assignments/derivatives, deletes the group rows, and re-syncs each affected device's AMAPI policy using `assignPolicyToDeviceWithDerivative`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/.netlify/functions/group-crud/list?environment_id={id}` | Session/API key | List all groups for an environment (nested) |
| GET | `/.netlify/functions/group-crud/descendants?group_id={id}` | Session/API key | List all descendants of a group |
| POST | `/.netlify/functions/group-crud/create` | Session/API key | Create a new group |
| PUT | `/.netlify/functions/group-crud/update` | Session/API key | Update a group (name, description, parent) |
| POST | `/.netlify/functions/group-crud/bulk` | Session/API key | Bulk delete or move groups |
| DELETE | `/.netlify/functions/group-crud/{groupId}` | Session/API key | Delete a group and all descendants |
