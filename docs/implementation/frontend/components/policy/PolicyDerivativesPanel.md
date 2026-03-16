# `src/components/policy/PolicyDerivativesPanel.tsx`

> Panel displaying policy derivatives (scope-specific AMAPI policy variations), bulk group assignment, and deployment status.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `PolicyDerivativesPanel` | `React.FC<{ policyId: string; policyName?: string }>` (default) | Renders group assignment UI, assignment map, derivatives table, and deployment progress |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `policyId` | `string` | Yes | The policy to display derivatives for |
| `policyName` | `string` | No | Display name of the policy, used in confirmation dialogs |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `toggleGroupId` | 105-109 | Toggles a group ID in/out of the `selectedGroupIds` array |
| `handleAssignGroups` | 111-153 | Bulk-assigns the policy to selected groups with confirmation prompts for overrides |
| `handleUnassignGroups` | 156-183 | Bulk-unassigns the policy from selected groups with confirmation |
| `handleUnassignSingle` | 185-196 | Unassigns the policy from a single group inline |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | Direct API call for sync mutation |
| `useContextStore` | `@/stores/context` | Reading the active environment |
| `usePolicyAssignments`, `useAssignPolicy`, `useUnassignPolicy` | `@/api/queries/policies` | Fetching assignments and mutating policy-group links |
| `useGroups` | `@/api/queries/groups` | Fetching the list of groups in the environment |
| `DeploymentProgress` | `@/components/deployment/DeploymentProgress` | Rendering deployment pipeline status |

## Key Logic

The panel is split into four major sections:

1. **Bulk Group Assignment** - A searchable checkbox list of all groups. Users can select multiple groups and assign/unassign the policy in bulk. Groups already assigned to this policy show an "Assigned" badge with an inline unassign button. Groups assigned to a different policy show the current policy name and trigger an override confirmation dialog.

2. **Assignment Map** - Displays all current assignments for this policy across scopes (environment, group, device) with lock status badges and derivative device counts.

3. **Derivatives Table** - Fetched via `GET /api/policies/derivatives`, shows each derivative's scope, target name, device count, override/variable badges, production status, and last sync time. A "Sync All" button triggers a `PUT /api/policies/update` with `push_to_amapi: true`.

4. **Deployment** - Renders a `DeploymentProgress` component for the active deployment job.

State resets (selected groups, search, feedback) whenever the environment or policy changes.
