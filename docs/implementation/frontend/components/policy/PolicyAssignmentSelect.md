# `src/components/policy/PolicyAssignmentSelect.tsx`

> Dropdown select for assigning or unassigning a policy at a given scope (environment, group, or device).

## Exports

| Name | Type | Description |
|------|------|-------------|
| `PolicyAssignmentSelect` | `React.FC<PolicyAssignmentSelectProps>` (default) | Renders a `<select>` of available policies with assign/unassign actions and inheritance indicators |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `scopeType` | `'environment' \| 'group' \| 'device'` | Yes | The scope level being assigned to |
| `scopeId` | `string` | Yes | ID of the scope entity (group ID, device ID, etc.) |
| `environmentId` | `string` | Yes | Environment to load policies from |
| `currentPolicyId` | `string \| null` | No | Currently assigned policy ID, if any |
| `currentSource` | `string` | No | Source of current assignment (e.g. `'environment'`, `'group'`, `'device_legacy'`) |
| `onAssigned` | `() => void` | No | Callback fired after a successful assign or unassign |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `handleChange` | 30-43 | Handles select change events; assigns a new policy or unassigns when blank is selected |
| `handleRevert` | 45-52 | Unassigns the current direct assignment, reverting to inherited policy |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `usePolicies`, `useAssignPolicy`, `useUnassignPolicy` | `@/api/queries/policies` | Fetching the policy list and mutating assignments |

## Key Logic

Loads all policies for the environment via `usePolicies` and renders them as `<option>` elements. When the selected value changes, it either assigns the new policy or unassigns if the blank option is chosen. A revert button (rotate icon) appears only when the policy is directly assigned at this scope (not inherited), allowing the user to remove the override and fall back to the inherited policy. Contextual messages display when the policy is inherited from a different scope or uses a legacy assignment model.
