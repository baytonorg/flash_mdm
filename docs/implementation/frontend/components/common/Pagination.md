# `src/components/common/Pagination.tsx`

> Pagination controls with page number buttons, previous/next navigation, per-page selector, and item range display.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Pagination` | `React.FC<PaginationProps>` (default) | Renders pagination UI with page buttons, prev/next arrows, per-page dropdown, and "Showing X-Y of Z" text |
| `PaginationProps` | `interface` | Props for the component |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `page` | `number` | Yes | Current page number (1-based) |
| `totalPages` | `number` | Yes | Total number of pages |
| `onPageChange` | `(page: number) => void` | Yes | Called when any page button or prev/next arrow is clicked |
| `perPage` | `number` | Yes | Current items-per-page value |
| `onPerPageChange` | `(perPage: number) => void` | No | Called when the per-page selector changes; selector hidden if omitted |
| `total` | `number` | Yes | Total number of items across all pages |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `getPages` | 27-40 | Computes an array of page numbers and ellipsis markers; shows all pages when `totalPages <= 7`, otherwise shows first, last, and current +/- 1 with ellipses |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `clsx` | `clsx` | Conditional styling for the active page button |
| `ChevronLeft`, `ChevronRight` | `lucide-react` | Previous/next page arrow icons |

## Key Logic

- Displays "Showing X - Y of Z" computed from `page`, `perPage`, and `total`.
- The per-page selector offers options `[10, 25, 50, 100]` and is only rendered when `onPerPageChange` is provided.
- Page number buttons use a smart truncation algorithm: when there are more than 7 pages, ellipsis markers are inserted between the first page, the current neighborhood (`page-1` to `page+1`), and the last page.
- Previous and next buttons are disabled at the bounds (`page <= 1` and `page >= totalPages`).
