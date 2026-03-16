# `netlify/functions/workflow-evaluate-background.ts`

> Background function that evaluates a single workflow against a specific device, checking conditions and executing the configured action (device command, group move, policy assign, email, webhook, or audit log).

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<void>` | Netlify background function handler |
| `config` | `{ type: 'background' }` | Netlify function config marking this as a background function |
| `buildWorkflowNotificationHtml` | `(workflow, device) => string` | Builds branded HTML email content for workflow notification actions |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `compareVersions` | 78-89 | Semantic version comparison returning -1/0/1 |
| `getNestedValue` | 91-99 | Dot-path accessor for nested objects (used by `custom.field` conditions) |
| `evaluateCondition` | 101-176 | Evaluates a single condition against a device; supports `device.state`, `device.ownership`, `device.os_version`, `device.manufacturer`, `device.group` (via closure table), `device.compliant`, and `custom.field` |
| `evaluateAllConditions` | 178-185 | AND-evaluates all conditions; returns true if empty |
| `executeAction` | 219-380 | Dispatches the workflow action by type, performing AMAPI calls, DB updates, emails, webhooks, or audit logging |
| `logWorkflowExecutionAudit` | 382-408 | Helper to log audit events for workflow executions with consistent structure |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute` | `_lib/db.js` | Database operations |
| `amapiCall` | `_lib/amapi.js` | Issue device commands and policy assignments via AMAPI |
| `buildAmapiCommandPayload` | `_lib/amapi-command.js` | Construct AMAPI command payloads from action config |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `sendEmail` | `_lib/resend.js` | Send notification emails |
| `BRAND` | `_lib/brand.js` | Brand name for email templates |
| `assignPolicyToDeviceWithDerivative` | `_lib/policy-derivatives.js` | Assign a policy to a device using derivative resolution |
| `requireInternalCaller` | `_lib/internal-auth.js` | Verify the request is from an internal function |
| `escapeHtml` | `_lib/html.js` | Escape HTML in email templates |
| `validateResolvedWebhookUrlForOutbound` | `_lib/webhook-ssrf.js` | SSRF protection for outbound webhook URLs |

## Key Logic

1. **Authentication**: Requires internal caller (not user-facing). Expects a JSON payload with `workflow_id`, `device_id`, and `trigger_data`.
2. **Validation**: Fetches the workflow (must be enabled) and device; verifies they share the same environment.
3. **Execution record**: Creates a `workflow_executions` row with status `running`.
4. **Condition evaluation**: Iterates all conditions (AND logic). Supported condition fields:
   - `device.state` / `device.ownership`: equality operators
   - `device.os_version`: semantic version comparisons (eq/gt/lt/gte/lte)
   - `device.manufacturer`: equals/contains/not_equals (case-insensitive)
   - `device.group`: uses `group_closures` table to check hierarchical group membership
   - `device.compliant`: boolean comparison
   - `custom.field`: dot-path lookup into `device.snapshot` with configurable operator
5. **Action execution** (if conditions pass):
   - `device.command`: Builds AMAPI command payload and issues it
   - `device.move_group`: Updates device's `group_id`
   - `device.assign_policy`: Updates device policy and syncs via `assignPolicyToDeviceWithDerivative`
   - `notification.email`: Sends branded HTML email via Resend
   - `notification.webhook`: POSTs device/workflow data to a URL (with SSRF validation and optional secret header)
   - `audit.log`: Writes a custom audit entry
6. **Status tracking**: Updates the execution record to `success`, `failed`, or `skipped` with result details. Updates `last_triggered_at` on the workflow.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/.netlify/functions/workflow-evaluate-background` | Internal caller (`x-internal-secret`) | Evaluate and execute a workflow for a device |
