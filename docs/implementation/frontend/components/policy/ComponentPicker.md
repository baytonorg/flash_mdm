# `src/components/policy/ComponentPicker.tsx`

> Dual-pane picker for assigning and unassigning reusable policy components to a policy, with config preview.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `ComponentPicker` | `React.FC<ComponentPickerProps>` (default) | Renders a two-column layout with available and assigned policy components |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `policyId` | `string` | Yes | The ID of the policy to manage component assignments for |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `CategoryBadge` | 38-45 | Renders a colored pill badge for a component category using `CATEGORY_STYLES` lookup |
| `handleAssign` | 64-66 | Fires the assign mutation with the policy and component IDs |
| `handleUnassign` | 68-70 | Fires the unassign mutation with the policy and component IDs |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useComponents`, `usePolicyComponents`, `useAssignComponent`, `useUnassignComponent`, `PolicyComponent`, `ComponentAssignment` | `@/api/queries/components` | Fetching all components, fetching assigned components, and mutating assignments |
| `useContextStore` | `@/stores/context` | Reading the active environment to scope the component list |

## Key Logic

The component fetches all available components for the active environment and the currently assigned components for the given policy. It computes the set difference to produce the "available" list. Each column is a scrollable list with assign (+) or unassign (-) buttons, plus an eye icon to toggle a JSON config preview panel. Assigned components display their priority number. A footer note explains merge priority order when more than one component is assigned.
