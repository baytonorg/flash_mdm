# `src/components/apps/AppScopeSelector.tsx`

> Radio-button selector for choosing an app deployment scope: environment-wide, group-specific, or device-specific, with dynamic group dropdown and device search.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `AppScopeSelector` | `default function` | Renders the scope selector UI |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `value` | `ScopeValue` | Yes | Current scope selection (`{ scope_type, scope_id }`) |
| `onChange` | `(value: ScopeValue) => void` | Yes | Callback when scope changes |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | Fetching groups and devices from the API |
| `useContextStore` | `@/stores/context` | Accessing the active environment ID |

## Key Logic

The component presents three radio-card options: Environment (deploy to all policies), Group (deploy to a specific group), and Device (deploy to a specific device). Each option shows an icon and description. When "Group" is selected, a `useQuery` fetches available groups for the active environment and renders a dropdown. When "Device" is selected, a search input triggers a `useQuery` (enabled after 2+ characters) that fetches matching devices and renders a selectable list showing device name, manufacturer/model, and serial number. The environment ID is read from the `useContextStore` Zustand store. Switching scope type resets the `scope_id` (environment type auto-fills with the environment ID).
