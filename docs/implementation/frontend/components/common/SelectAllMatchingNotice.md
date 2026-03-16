# `src/components/common/SelectAllMatchingNotice.tsx`

> Banner notice that appears when all loaded rows are selected, offering to extend selection to all matching rows across pages.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `SelectAllMatchingNotice` | `React.FC<SelectAllMatchingNoticeProps>` (default) | Renders a contextual notice about selection scope with an optional "select all matching" action |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `loadedCount` | `number` | Yes | Number of currently loaded (visible) rows |
| `totalCount` | `number` | Yes | Total number of matching rows across all pages |
| `allMatching` | `boolean` | Yes | Whether all matching rows (not just loaded) are already selected |
| `canSelectAllMatching` | `boolean` | Yes | Whether the "select all matching" option should be shown |
| `onSelectAllMatching` | `() => void` | Yes | Called when the user clicks the "Select all N matching" button |

## Key Logic

- Three render states:
  1. `allMatching === true`: shows a confirmation banner ("All N matching rows are selected") in an accent-colored box.
  2. `canSelectAllMatching === true` (and not all matching): shows "All N loaded rows are selected" with a clickable link to select all matching rows.
  3. Otherwise: returns `null`.
- Numbers are formatted with `toLocaleString()` for readability.
