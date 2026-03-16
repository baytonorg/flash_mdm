# `src/components/flashi/FlashiButton.tsx`

> Fixed-position floating action button (FAB) that toggles the Flashi chat panel. Positioned bottom-right at z-[55].

## Key Details

- Uses the `Bot` icon from `lucide-react`.
- Toggles chat state via `useFlashagentStore.toggleChat()`.
- Only rendered when `flashiEnabled` is true in `MainLayout`.
- Accessible: includes `aria-label="Open Flashi assistant"`.
- Styled with accent colour, rounded-full, shadow-lg.
