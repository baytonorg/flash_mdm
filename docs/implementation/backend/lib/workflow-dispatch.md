# `netlify/functions/_lib/workflow-dispatch.ts`

> Dispatches workflow evaluation jobs into the job queue when device events (enrollment, state changes, app installs, geofence crossings, etc.) occur.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `WorkflowEventInput` | `interface` | Shape for a device event: `environmentId`, `deviceId`, optional `deviceGroupId`, `triggerType`, and `triggerData` |
| `dispatchWorkflowEvent` | `(input: WorkflowEventInput) => Promise<number>` | Finds enabled workflows matching the trigger type and scope, enqueues `workflow_evaluate` jobs, and returns the count of jobs enqueued. Failures are caught and logged as non-fatal warnings. |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `isDeviceInWorkflowScope` | 100-122 | Checks if a device falls within a workflow's scope: environment-scoped workflows match all devices; group-scoped workflows check the `group_closures` table for ancestor/descendant relationship |
| `parseTriggerConfig` | 126-132 | Safely parses `trigger_config` from JSON string or object to a plain object; returns `{}` on failure |
| `matchesTriggerConfig` | 138-173 | Per-trigger-type filter matching: `device.state_changed` checks optional `from_state`/`to_state`; `app.installed`/`app.removed` checks optional `package_name`; `location.fence_entered`/`location.fence_exited` checks optional `geofence_id`; all other trigger types pass unconditionally |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `execute` | `_lib/db.js` | Querying workflows table and inserting jobs into `job_queue` |

## Key Logic

When a device event occurs, the sync processor calls `dispatchWorkflowEvent`. The function queries the `workflows` table for all enabled workflows in the same environment with a matching `trigger_type`.

For each candidate workflow, two filters are applied sequentially:
1. **Scope check** -- environment-scoped workflows match all devices; group-scoped workflows verify the device's group is a descendant of (or equal to) the workflow's `scope_id` via the `group_closures` closure table.
2. **Trigger config check** -- optional per-trigger-type filters (e.g. `from_state`/`to_state` for state changes, `package_name` for app events, `geofence_id` for location events). If no filter is configured, the workflow matches all events of that trigger type.

Matching workflows get a `workflow_evaluate` job enqueued in `job_queue` with the workflow ID, device ID, and full trigger data. The entire dispatch is wrapped in a try/catch so failures never break the main event processing pipeline.
