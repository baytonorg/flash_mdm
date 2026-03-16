# `src/stores/flashagent.ts`

> Zustand store for Flashi chat panel open/close state.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `useFlashagentStore` | `UseBoundStore<StoreApi<FlashagentState>>` | Zustand store hook |

## State

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `chatOpen` | `boolean` | `false` | Whether the Flashi chat panel is visible |

## Actions

| Action | Description |
|--------|-------------|
| `toggleChat()` | Toggles `chatOpen` |
| `setChatOpen(open)` | Sets `chatOpen` to a specific value |
