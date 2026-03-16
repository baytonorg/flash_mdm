# `src/components/policy/LockControls.tsx`

> UI for locking an entire policy or individual AMAPI sections to prevent child-scope overrides.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `LockControls` | `React.FC<LockControlsProps>` (default) | Renders a full-lock toggle and per-section checkbox list with inherited lock awareness |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `policyId` | `string` | Yes | Policy to set locks on |
| `scopeType` | `'environment' \| 'group' \| 'device'` | Yes | Scope level of the assignment |
| `scopeId` | `string` | Yes | ID of the scope entity |
| `currentLocked` | `boolean` | Yes | Whether the policy is currently fully locked at this scope |
| `currentLockedSections` | `string[]` | Yes | Array of AMAPI section keys currently locked at this scope |
| `inheritedLockState` | `{ fully_locked: boolean; locked_sections: string[]; locked_by_scope_name?: string \| null }` | No | Read-only lock state inherited from ancestor scopes |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `toggleFullLock` | 76-78 | Toggles the local full-lock boolean state |
| `toggleSectionLock` | 80-87 | Adds or removes an individual section key from the local locked sections array |
| `handleSave` | 89-102 | Persists local lock state via `useSetPolicyLocks` mutation |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useSetPolicyLocks` | `@/api/queries/policies` | Mutation to persist lock settings to the backend |

## Key Logic

Maintains local state for `locked` (boolean) and `lockedSections` (string array), initialized from current props. A `hasChanges` flag compares local vs. current state to conditionally show a "Save locks" button. When an ancestor scope has a full lock, the entire UI is replaced with a read-only notice. Otherwise, a toggle switch controls the full lock, and when not fully locked, a scrollable checkbox list of 35+ AMAPI section keys (`LOCKABLE_SECTIONS`) is displayed. Sections inherited from ancestor scopes are shown as disabled checkboxes with an "inherited" label.
