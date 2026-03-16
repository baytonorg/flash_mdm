# `src/components/common/EmptyState.tsx`

> Centered placeholder UI shown when a list or view has no content, with optional icon and action button.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `EmptyState` | `React.FC<EmptyStateProps>` (default) | Renders a vertically centered empty state with icon, title, description, and optional CTA |
| `EmptyStateProps` | `interface` | Props for the component |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `icon` | `ReactNode` | No | Custom icon; defaults to `Inbox` from lucide-react |
| `title` | `string` | Yes | Primary heading text |
| `description` | `string` | No | Secondary explanatory text |
| `action` | `{ label: string; onClick: () => void }` | No | Optional call-to-action button |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `Inbox` | `lucide-react` | Default icon when no custom icon is provided |

## Key Logic

- Simple presentational component with no state.
- Renders a centered column layout with generous vertical padding (`py-16`).
- The action button, when provided, uses the accent color and calls `action.onClick`.
