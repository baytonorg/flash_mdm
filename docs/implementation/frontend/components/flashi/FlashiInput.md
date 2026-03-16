# `src/components/flashi/FlashiInput.tsx`

> Auto-growing textarea input for the Flashi chat panel with send button.

## Key Details

- Auto-resizes vertically based on content (max 5 rows).
- `maxLength={8000}` enforced at the input level.
- Enter to send, Shift+Enter for newline.
- Send button disabled when loading or input is empty/whitespace.
- Shows a disabled state with reason text when the feature gate blocks usage.
- Accessible: includes `aria-label` on the send button.
