# `src/components/common/ContextSwitcher.tsx`

> Sidebar component for switching the active workspace, environment, and group context.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `ContextSwitcher` | `React.FC` (default) | Renders cascading dropdowns for workspace, environment, and group selection |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `StaticValue` | 3-9 | Helper component that renders a read-only styled div when only one option is available |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useContextStore` | `@/stores/context` | Zustand store providing workspace/environment/group lists, active selections, and switch functions |

## Key Logic

- Reads all context state from `useContextStore`: `workspaces`, `environments`, `groups`, their active counterparts, and `switchWorkspace`, `switchEnvironment`, `switchGroup` actions.
- Each level (workspace, environment, group) conditionally renders either a static read-only value (when there is only one option) or a `<select>` dropdown (when multiple options exist).
- Environment selector only appears after a workspace is active. Group selector only appears after an environment is active and groups exist.
- Environment display includes the enterprise name (stripped of the `enterprises/` prefix) when available.
- Group options are indented using non-breaking spaces based on the group's `depth` property to represent hierarchy.
