# `src/pages/WorkflowBuilder.tsx`

> Accordion-based workflow editor for creating and editing event-driven automation workflows.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `WorkflowBuilder` | `React.FC` (default) | Workflow create/edit page component |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `Section` | 39-69 | Reusable accordion section component with step number, title, description, and toggle |
| `WorkflowBuilder` | 73-427 | Main page component with four-section builder and execution history |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useContextStore` | `@/stores/context` | Active environment and groups |
| `useEnvironmentGuard` | `@/hooks/useEnvironmentGuard` | Redirect if workflow belongs to a different environment |
| `useWorkflow`, `useCreateWorkflow`, `useUpdateWorkflow`, `useTestWorkflow` | `@/api/queries/workflows` | Workflow CRUD and test execution hooks |
| `ConditionRow` (type) | `@/api/queries/workflows` | Type for workflow condition rows |
| `TriggerSelector` | `@/components/workflows/TriggerSelector` | Trigger type and configuration selector |
| `ConditionBuilder` | `@/components/workflows/ConditionBuilder` | Condition rule builder |
| `ActionSelector` | `@/components/workflows/ActionSelector` | Action type and configuration selector |
| `ExecutionHistory` | `@/components/workflows/ExecutionHistory` | Recent execution log display |
| `PageLoadingState` | `@/components/common/PageLoadingState` | Loading spinner |

## Key Logic

The page operates in create mode (no `id` param) or edit mode (with `id` param). In edit mode, it fetches the existing workflow and populates form state.

The builder is organized into four collapsible accordion sections:

1. **Basics**: Workflow name, enabled/disabled toggle, and scope selector (entire environment or a specific group selected from a dropdown).

2. **Trigger**: Uses `TriggerSelector` to choose the event type (e.g. `device.enrolled`) and configure trigger-specific parameters.

3. **Conditions**: Uses `ConditionBuilder` to define optional filter conditions that determine which devices the workflow applies to.

4. **Action**: Uses `ActionSelector` to choose what happens when the workflow triggers (e.g. `device.command`) and configure action-specific parameters.

The top bar provides a "Test Run" button (edit mode only) that executes a test run via `useTestWorkflow` and a "Save Workflow" button. Success, error, and test result feedback is displayed as banners.

For existing workflows, an execution history panel shows the last 50 executions below the builder sections.
