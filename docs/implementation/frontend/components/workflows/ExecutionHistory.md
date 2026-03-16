# `src/components/workflows/ExecutionHistory.tsx`

> Timeline-style display of workflow execution history with status badges, device info, trigger data, and result payloads.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `ExecutionHistory` | `default function` | Vertical timeline rendering a list of workflow executions |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `executions` | `WorkflowExecution[]` | Yes | Array of execution records to display |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `WorkflowExecution` | `@/api/queries/workflows` | Type definition for execution records |

## Key Logic

Renders a vertical timeline with a connector line between entries. Each execution card shows:

1. **Status badge** -- colour-coded pill with icon. Six statuses are supported: `success` (green), `failed` (red), `pending` (amber), `running` (blue), `skipped` (gray), `dry_run` (purple).
2. **Timestamp** -- formatted as short month, day, hour, and minute.
3. **Device info** -- manufacturer, model, and serial number (shown if present).
4. **Trigger data** -- JSON-formatted in a scrollable `<pre>` block, shown if non-empty.
5. **Result** -- JSON-formatted, with red background for failed executions.

When the executions array is empty, a placeholder message is displayed indicating no executions have occurred yet.
