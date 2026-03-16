# `src/stores/ui.ts`

> Zustand store for global UI preferences: sidebar visibility and list view mode.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `useUiStore` | `UseBoundStore<StoreApi<UiState>>` | Zustand hook providing UI state and setters |

## Internal Types

| Name | Description |
|------|-------------|
| `ViewMode` | `'table' \| 'card'` -- the two list display modes |
| `UiState` | Store shape with `sidebarOpen`, `viewMode`, and three action methods |

## Key Logic

- **Sidebar**: `sidebarOpen` defaults to `true`. `toggleSidebar` flips it; `setSidebarOpen` sets it explicitly.
- **View mode**: `viewMode` defaults to `'table'`. `setViewMode` switches between `'table'` and `'card'`.
- No persistence -- state resets on page reload.
