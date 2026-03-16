# `src/api/queries/flashagent.ts`

> React Query hooks for Flashi assistant settings management at both environment and workspace level. Chat, persistence, and history clearing are handled directly by the `useFlashiChat` hook via `apiClient`.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `FlashiSettingsResponse` | `interface` | Environment-level settings response shape (see below) |
| `FlashiWorkspaceSettingsResponse` | `interface` | Workspace-level settings response shape (see below) |
| `useFlashiSettings` | `(environmentId?) => UseQueryResult` | Fetches effective assistant settings for an environment (30s stale time) |
| `useUpdateFlashiSettings` | `() => UseMutationResult` | Toggles environment-level assistant enabled state and optional role, invalidates settings query on success |
| `useFlashiWorkspaceSettings` | `(workspaceId?) => UseQueryResult` | Fetches workspace-level assistant settings (30s stale time) |
| `useUpdateFlashiWorkspaceSettings` | `() => UseMutationResult` | Updates workspace-level settings (enabled, roles, OpenAI overrides), invalidates workspace settings query on success |

## Interfaces

### `FlashiSettingsResponse`

```typescript
{
  platform_assistant_enabled: boolean;
  workspace_assistant_enabled: boolean;
  workspace_assistant_max_role: "viewer" | "member" | "admin";
  workspace_assistant_default_role: "viewer" | "member" | "admin";
  environment_assistant_role: "viewer" | "member" | "admin";
  effective_assistant_role: "viewer" | "member" | "admin";
  environment_assistant_enabled: boolean;
  effective_enabled: boolean;
}
```

### `FlashiWorkspaceSettingsResponse`

```typescript
{
  platform_assistant_enabled: boolean;
  workspace_assistant_enabled: boolean;
  workspace_assistant_max_role: "viewer" | "member" | "admin";
  workspace_assistant_default_role: "viewer" | "member" | "admin";
  workspace_openai_override_configured: boolean;
  workspace_openai_model: string | null;
}
```

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

### Environment Settings

- `useFlashiSettings` is the primary feature gate check — returns `effective_enabled` used to show/hide the Flashi button and panel.
- `useUpdateFlashiSettings` sends `{ environment_id, enabled, role? }` via PUT to `/api/flashagent/settings`. The `role` parameter (optional) sets the environment's assistant role, clamped server-side to the workspace's `max_role`. Invalidates the settings query on success.

### Workspace Settings

- `useFlashiWorkspaceSettings` fetches workspace-level configuration from `/api/flashagent/workspace-settings` including enabled state, role boundaries, and OpenAI override status.
- `useUpdateFlashiWorkspaceSettings` sends updates via PUT to `/api/flashagent/workspace-settings`. Supports: `assistant_enabled`, `max_role`, `default_role`, `openai_api_key`, `clear_openai_api_key`, `openai_model`. Invalidates the workspace settings query on success.

### General

- Chat messaging, history persistence, and history clearing are intentionally **not** exposed as React Query hooks. The `useFlashiChat` hook manages these operations directly via `apiClient` for tighter control over optimistic updates and local state synchronisation.
