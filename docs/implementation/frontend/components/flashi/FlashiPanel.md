# `src/components/flashi/FlashiPanel.tsx`

> Floating chat panel for the Flashi assistant. Renders as a fixed-position overlay with header controls, message list, and input.

## Key Details

- **Desktop**: 400w × 550h, positioned bottom-right above the FAB.
- **Mobile**: Full-width, 75vh height.
- `role="dialog"`, `aria-label="Flashi assistant"`.
- Escape key closes the panel.
- Tab/Shift+Tab focus trapping keeps keyboard navigation within the panel.
- Header includes: title ("Flashi"), download button, clear button, close button.
- Composes: `FlashiMessageList` (scrollable message area) and `FlashiInput` (text input).
- z-index: 55 (above sidebar, below modals).
- Destructures `environmentId` from `useFlashiChat()` for environment-aware operations.

## Dependencies

| Import | From | Used for |
|--------|------|----------|
| `useFlashiChat` | `@/hooks/useFlashiChat` | Chat state and actions (`chatHistory`, `textInput`, `setTextInput`, `isChatLoading`, `chatLoadingStep`, `chatEndRef`, `submitMessage`, `clearChatHistory`, `downloadChatHistory`, `environmentId`) |
| `useFlashagentStore` | `@/stores/flashagent` | Panel open/close state |
| `FlashiMessageList` | `./FlashiMessageList` | Message rendering |
| `FlashiInput` | `./FlashiInput` | Text input |
