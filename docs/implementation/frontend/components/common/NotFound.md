# `src/components/common/NotFound.tsx`

> Full-page 404 component displayed when a route does not match.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `NotFound` | `React.FC` (default) | Renders a centered card with a "Page not found" message and a link to the dashboard |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `FileQuestion` | `lucide-react` | Question-mark file icon |

## Key Logic

- Stateless presentational component.
- Fills the full viewport height (`min-h-screen`) with a centered card.
- Provides a single "Go to Dashboard" link pointing to `/`.
