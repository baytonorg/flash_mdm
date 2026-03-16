# `src/hooks/useFlashiChat.ts`

> Main chat hook for Flashi. Manages message state, history hydration, persistence, sending, progress steps, and error handling. Adapted from MCP-POC's `useAssistantChat.ts`.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `FlashiMessage` | `interface` | `{ role: 'user' \| 'assistant'; text: string; timestamp: number }` |
| `useFlashiChat` | `(environmentId?) => FlashiChatReturn` | Main hook returning chat state and actions |

## Return Value

| Field | Type | Description |
|-------|------|-------------|
| `chatHistory` | `FlashiMessage[]` | Current conversation messages |
| `textInput` | `string` | Current input value |
| `setTextInput` | `(value) => void` | Update input value |
| `isChatLoading` | `boolean` | Whether a request is in flight |
| `chatLoadingStep` | `string` | Current progress step text |
| `submitMessage` | `() => void` | Send the current input |
| `clearChatHistory` | `() => void` | Clear all messages |
| `downloadChatHistory` | `() => void` | Download chat as markdown |
| `chatEndRef` | `RefObject` | Ref for auto-scrolling to bottom |
| `environmentId` | `string \| undefined` | Active environment ID from context store |

## Key Logic

### History hydration
- On environment change, fetches chat history from server via `useFlashiChatHistory`.
- Normalises messages from the API format to `FlashiMessage`.

### Message persistence
- Uses an append-only queue pattern: new messages are queued and persisted in batches.
- Stale closure prevention via `chatHistoryRef` (synced after each render).
- Environment staleness check: discards responses if `environmentId` changed during the request.

### Error handling
- `friendlyErrorMessage()` sanitises backend errors (filters out OpenAI/SQL details, truncates long messages).
- Error messages are prefixed with a warning emoji for visual distinction.

### Progress steps
- Uses `flashiProgress.ts` to generate contextual loading steps based on message keywords.
- Progress interval updates every 3 seconds during loading.
- Cleaned up on unmount via `useEffect` cleanup.

### Send flow
1. Appends user message to history.
2. Builds context messages from recent history (last 10, capped at 1000 chars).
3. POSTs to `/api/flashagent/chat` with retry (3 attempts, exponential backoff on 5xx).
4. On success: appends assistant reply, queues both messages for persistence.
5. On error: appends friendly error message.
