# `src/components/common/PageLoadingState.tsx`

> Centered spinner with label, used as a full-page or section loading indicator.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `PageLoadingState` | `React.FC<PageLoadingStateProps>` (default) | Renders a centered loading spinner with a text label |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `label` | `string` | No | Text displayed next to the spinner. Default `'Loading...'` |
| `compact` | `boolean` | No | Uses reduced vertical padding (`py-16` vs `py-24`). Default `false` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `Loader2` | `lucide-react` | Spinning loader icon |

## Key Logic

- Stateless presentational component.
- The `Loader2` icon uses `animate-spin` for continuous rotation.
- The `compact` prop controls vertical padding, allowing use in both full-page and inline-section contexts.
