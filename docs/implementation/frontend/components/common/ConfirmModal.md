# `src/components/common/ConfirmModal.tsx`

> Modal dialog for confirming destructive or important actions, with danger and default variants.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `ConfirmModal` | `React.FC<ConfirmModalProps>` (default) | Renders a centered modal overlay with title, message, cancel, and confirm buttons |
| `ConfirmModalProps` | `interface` | Props for the component |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `open` | `boolean` | Yes | Controls visibility of the modal |
| `onClose` | `() => void` | Yes | Called when the user dismisses the modal (overlay click, Escape key, or Cancel button) |
| `onConfirm` | `() => void` | Yes | Called when the confirm button is clicked |
| `title` | `string` | Yes | Modal heading text |
| `message` | `string` | Yes | Explanatory body text |
| `confirmLabel` | `string` | No | Label for the confirm button. Default `'Confirm'` |
| `variant` | `'danger' \| 'default'` | No | Visual style; `danger` shows a red warning icon and red confirm button. Default `'default'` |
| `loading` | `boolean` | No | Disables buttons and shows `'Processing...'` on the confirm button. Default `false` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `clsx` | `clsx` | Conditional class names for button variant styling |
| `AlertTriangle` | `lucide-react` | Warning icon shown in `danger` variant |

## Key Logic

- Listens for the `Escape` key via a `useEffect` keyboard listener to close the modal.
- Clicking the backdrop overlay (but not the modal content) also triggers `onClose`.
- Returns `null` when `open` is `false`.
- The `danger` variant renders an `AlertTriangle` icon in a red circle and styles the confirm button red; the `default` variant uses the accent color.
