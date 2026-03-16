# `src/components/geofencing/FenceScopeSelector.tsx`

> Renders a scope selector (environment / group / device) for geofence targeting, with debounced device search.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `FenceScopeSelector` | `default function` | Scope selector widget with radio buttons and conditional pickers |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `value` | `FenceScopeValue` | Yes | Current scope selection (`{ scope_type, scope_id }`) |
| `onChange` | `(value: FenceScopeValue) => void` | Yes | Callback when scope changes |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `handleScopeTypeChange` | 59-66 | Switches scope type, resets device search state when leaving device mode |
| `handleGroupChange` | 68-70 | Sets scope to a selected group ID |
| `handleDeviceSelect` | 72-77 | Sets scope to a selected device, updates display name, clears search |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useContextStore` | `@/stores/context` | Access `activeEnvironment` and `groups` from context |
| `apiClient` | `@/api/client` | Debounced device search API call |

## Key Logic

The component presents three radio buttons for scope type: environment, group, or device. When "group" is selected, a `<select>` dropdown populated from the context store's `groups` array is shown, with indentation based on `group.depth`. When "device" is selected, a search input with 300ms debounce queries `/api/devices/list` and renders results in a dropdown overlay. Once a device is selected, its display name is shown with a "Clear" button. The `useEffect` for device search includes a cleanup function to cancel stale timeouts.
