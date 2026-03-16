# `src/components/common/GlobalSearch.tsx`

> Full-screen modal search that queries devices, policies, groups, and users with debounced input and keyboard navigation.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `GlobalSearch` | `React.FC<GlobalSearchProps>` (default) | Renders a search modal dialog with categorized results |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `open` | `boolean` | Yes | Controls visibility of the search modal |
| `onClose` | `() => void` | Yes | Called to dismiss the modal (backdrop click, Escape via parent, or close button) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `performSearch` | 49-149 | Async function that fires parallel API requests for devices, policies, groups, and users, then aggregates results |
| `handleSelect` | 168-171 | Navigates to the selected result's path and closes the modal |
| `handleKeyDown` | 173-184 | Handles `ArrowUp`, `ArrowDown`, and `Enter` for keyboard navigation through results |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | HTTP client for querying search endpoints |
| `useContextStore` | `@/stores/context` | Provides `activeEnvironment` to scope searches to the current environment |
| `useNavigate` | `react-router` | Programmatic navigation to selected result |
| `Search`, `Smartphone`, `Shield`, `FolderTree`, `Users`, `X`, `Loader2` | `lucide-react` | Icons for the input, result categories, close button, and loading spinner |

## Key Logic

- Search input is debounced at 300ms via a `setTimeout` ref pattern.
- Four parallel API calls search across `devices`, `policies`, `groups`, and `users` scoped by `environmentId`.
- Devices use server-side search (`?search=`); policies, groups, and users are fetched in full and filtered client-side with case-insensitive substring matching.
- Results are grouped by category using `CATEGORY_CONFIG`, which maps each category to an icon, label, and color badge.
- Keyboard navigation tracks an `activeIndex` across the flattened results list; `Enter` selects the active result.
- The input auto-focuses when the modal opens (with a 50ms delay for render).
- A footer displays keyboard shortcut hints for navigation, selection, and closing.
