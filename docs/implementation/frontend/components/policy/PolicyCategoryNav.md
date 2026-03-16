# `src/components/policy/PolicyCategoryNav.tsx`

> Sidebar navigation listing policy configuration categories, filtered by management scenario.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `PolicyCategoryNav` | `React.FC<PolicyCategoryNavProps>` (default) | Renders a vertical nav list of policy category buttons with icons |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `activeCategory` | `string` | Yes | Currently selected category ID |
| `onCategoryChange` | `(cat: string) => void` | Yes | Callback when a category is clicked |
| `scenario` | `string` | Yes | Management scenario string (e.g. `'wp'`, `'fm'`) used to filter scenario-specific categories |
| `isNew` | `boolean` | No | When true, hides non-policy extra items (e.g. derivatives) for new unsaved policies |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `renderItem` | 70-90 | Renders a single category button with icon, label, and active/inactive styling |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|

No project-internal imports. Uses `clsx` and `lucide-react` icons only.

## Key Logic

Defines a static `CATEGORIES` array of 15 category definitions, each with an `id`, `label`, `icon`, and optional `scenarios` filter. Categories like "Personal Usage" are restricted to `wp` (work profile) and "Kiosk Mode" to `fm` (fully managed). The component filters categories by the active scenario, then renders them as a vertical button list. Below a separator, `EXTRA_ITEMS` (currently just "Policy Derivatives") are rendered unless `isNew` is true. Active category is highlighted with accent color styling.
