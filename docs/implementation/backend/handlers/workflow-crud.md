# `netlify/functions/workflow-crud.ts`

> Full CRUD handler for workflows including list, get (with recent executions), create, update, delete, toggle enable/disable, test (dry-run), and bulk operations.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `validateWorkflowBody` | 106-124 | Validates required fields and checks `trigger_type`, `action_type`, and condition `field` values against allowed lists |
| `validateAndNormalizeWorkflowScope` | 126-188 | Validates `scope_type` (environment/group/device) and verifies `scope_id` exists in the target environment |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute` | `_lib/db.js` | Database operations |
| `requireAuth` | `_lib/auth.js` | Authenticate the caller |
| `requireEnvironmentPermission` | `_lib/rbac.js` | Enforce read/write/delete permission |
| `logAudit` | `_lib/audit.js` | Audit logging for all workflow mutations |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp`, `getSearchParams` | `_lib/helpers.js` | HTTP utilities |

## Key Logic

**Validation constants**:
- `VALID_TRIGGER_TYPES`: `device.enrolled`, `device.state_changed`, `compliance.changed`, `app.installed`, `app.removed`, `location.fence_entered`, `location.fence_exited`, `scheduled`
- `VALID_ACTION_TYPES`: `device.command`, `device.move_group`, `device.assign_policy`, `notification.email`, `notification.webhook`, `audit.log`
- `VALID_CONDITION_FIELDS`: `device.state`, `device.ownership`, `device.os_version`, `device.manufacturer`, `device.group`, `device.compliant`, `custom.field`

**Routes**:
- **List**: Returns workflows with execution count and last execution status via a lateral join on `workflow_executions`.
- **Get**: Returns a single workflow plus its 50 most recent executions (joined with device info).
- **Create**: Validates body, normalizes scope, inserts the workflow, and returns it.
- **Update**: Validates body against the existing workflow's environment, updates all fields.
- **Delete**: Requires `delete` permission, removes the workflow.
- **Toggle**: Flips the `enabled` flag on a workflow.
- **Test**: Creates a dry-run `workflow_execution` record for a specified (or first available) device; no actual actions are performed.
- **Bulk**: Supports `enable`, `disable`, and `delete` operations across a selection of workflow IDs (explicit or `all_matching` with exclusions).

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/workflows/list?environment_id=...` | `read` | List all workflows for an environment |
| `GET` | `/api/workflows/:id` | `read` | Get a single workflow with recent executions |
| `POST` | `/api/workflows/create` | `write` | Create a new workflow |
| `PUT` | `/api/workflows/update` | `write` | Update an existing workflow |
| `DELETE` | `/api/workflows/:id` | `delete` | Delete a workflow |
| `POST` | `/api/workflows/:id/toggle` | `write` | Toggle workflow enabled/disabled |
| `POST` | `/api/workflows/:id/test` | `write` | Create a dry-run test execution |
| `POST` | `/api/workflows/bulk` | `write` | Bulk enable/disable/delete workflows |
