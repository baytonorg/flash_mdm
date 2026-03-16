# `src/components/common/LivePageIndicator.tsx`

> Small pulsing icon indicator showing that a page auto-refreshes on an interval.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `LivePageIndicator` | `React.FC<LivePageIndicatorProps>` (default) | Renders a pulsing radio icon with a tooltip describing the refresh interval |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `intervalMs` | `number` | Yes | Refresh interval in milliseconds, used in the tooltip |
| `lastUpdatedAt` | `number` | No | Timestamp (ms) of the last refresh; shown as a formatted time in the tooltip |
| `className` | `string` | No | Additional CSS classes. Default `''` |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `formatInterval` | 9-16 | Converts a millisecond interval to a human-readable string like `"5 minutes"` or `"30 seconds"` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `Radio` | `lucide-react` | Pulsing radio/broadcast icon |

## Key Logic

- Purely presentational; no state or side effects.
- The `title` and `aria-label` attributes provide an accessible description including the interval and last-updated time.
- The `Radio` icon uses `animate-pulse` for a visual live indicator effect.
