# `src/components/policy/PolicyOverrideEditor.tsx`

> Editor for viewing and modifying scoped policy overrides at the group or device level, with per-category form rendering and lock management.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `PolicyOverrideEditor` | `React.FC<PolicyOverrideEditorProps>` (default) | Renders a collapsible category list with override forms, lock controls, and save/reset actions |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `policyId` | `string` | Yes | The base policy being overridden |
| `scopeType` | `'group' \| 'device'` | Yes | Scope level of the override |
| `scopeId` | `string` | Yes | ID of the group or device |
| `environmentId` | `string` | Yes | Environment ID for fetching assignments |
| `onClose` | `() => void` | No | Optional callback (currently unused internally, prefixed with `_`) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `CategoryFormAdapter` | 220-266 | Adapter component that merges base config with overrides and routes `PolicyFormSection` changes back as individual AMAPI key overrides |
| `setDeep` | 269-282 | Deep-sets a value at a dot-separated path within an object, creating intermediate objects/arrays as needed |
| `toggleSection` | 371-378 | Toggles a category section expanded/collapsed in the UI |
| `updateOverrideDirect` | 381-383 | Sets an override value for a single AMAPI key |
| `resetCategory` | 386-395 | Removes all override keys belonging to a specific category |
| `handleSave` | 397-410 | Persists the current override config via `useSavePolicyOverride` mutation |
| `handleResetAll` | 412-424 | Resets all overrides for this scope via `useResetPolicyOverride` mutation |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `usePolicyOverride`, `useSavePolicyOverride`, `useResetPolicyOverride` | `@/api/queries/policy-overrides` | Fetching current overrides, saving changes, and resetting all overrides |
| `usePolicy`, `usePolicyAssignments` | `@/api/queries/policies` | Fetching the base policy config and assignment records (for lock state) |
| `LockControls` | `@/components/policy/LockControls` | Embedded lock settings panel |
| `PolicyFormSection` | `@/components/policy/PolicyFormSection` | Category-specific form rendering via `CategoryFormAdapter` |

## Key Logic

This component provides scoped policy override editing. It defines two large static mappings:

- `AMAPI_SECTIONS` (70 entries) - maps every AMAPI top-level key to a human-readable label.
- `AMAPI_KEY_TO_FORM_CATEGORY` (80+ entries) - maps every AMAPI key to a `PolicyFormSection` category ID.

On load, it fetches the override data and base policy. It computes `availableCategories` by grouping all known AMAPI keys into categories and annotating each with override count, lock status, and configured status. Categories are rendered as collapsible accordion rows. Expanded categories render a `CategoryFormAdapter` that:

1. Merges base config with current overrides into a synthetic config object.
2. Passes it to `PolicyFormSection` for form rendering.
3. Routes changes back by extracting the top-level AMAPI key from the dot-path and calling `updateOverrideDirect`.

Lock state is displayed as notices (fully locked by ancestor, or N sections locked). A collapsible `LockControls` panel allows managing locks at this scope. Categories that are fully locked are shown as non-expandable with a lock icon.

Local override state is tracked separately from server state; a "Save overrides" button appears when unsaved changes exist.
