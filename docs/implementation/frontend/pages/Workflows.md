# `src/pages/Workflows.tsx`

> Lists and manages automation workflows for the active environment with filtering, bulk actions, and inline toggle.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Workflows` | `React.FC` (default) | Workflow list page component |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `getTriggerLabel` | 17-19 | Looks up trigger display metadata from `TRIGGER_OPTIONS` |
| `getActionLabel` | 21-23 | Looks up action display metadata from `ACTION_OPTIONS` |
| `Workflows` | 33-317 | Main page component with workflow table, filters, bulk actions, and delete modal |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useContextStore` | `@/stores/context` | Active environment access |
| `useWorkflows`, `useDeleteWorkflow`, `useToggleWorkflow`, `useBulkWorkflowAction`, `Workflow` (type) | `@/api/queries/workflows` | Workflow list, delete, toggle, and bulk action hooks |
| `DataTable`, `ColumnDef` (type) | `@/components/common/DataTable` | Sortable data table |
| `TRIGGER_OPTIONS` | `@/components/workflows/TriggerSelector` | Trigger type metadata for display |
| `ACTION_OPTIONS` | `@/components/workflows/ActionSelector` | Action type metadata for display |
| `BulkActionBar`, `BulkAction` (type) | `@/components/common/BulkActionBar` | Floating bulk action toolbar |
| `SelectAllMatchingNotice` | `@/components/common/SelectAllMatchingNotice` | "Select all matching" notice |
| `useBulkSelection` | `@/hooks/useBulkSelection` | Checkbox selection state |

## Key Logic

The page fetches all workflows for the active environment and displays them in a `DataTable`. Columns include name, trigger (with icon and colored badge from `TRIGGER_OPTIONS`), action (with icon and colored badge from `ACTION_OPTIONS`), enabled toggle switch, last run timestamp, execution count, and a delete button.

Status filtering (all/enabled/disabled) is applied client-side. The enabled toggle calls `useToggleWorkflow` inline without navigation.

Bulk actions include enable, disable, and delete. These are dispatched through `useBulkWorkflowAction` with confirmation dialogs. Individual deletion uses a modal confirmation that warns about execution history removal.

Clicking a workflow row navigates to `/workflows/{id}` (the workflow builder/editor). The "Create Workflow" button navigates to `/workflows/new`. State resets on environment change.
