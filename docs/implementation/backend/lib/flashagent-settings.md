# `netlify/functions/_lib/flashagent-settings.ts`

> Resolves effective Flashi assistant settings by combining the platform-level toggle, workspace-level configuration, and the per-environment toggle. Provides getters and setters for workspace and environment assistant settings, including role management and environment-scoped API key lifecycle.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `EffectiveAssistantSettings` | `interface` | Full effective settings: platform, workspace, environment enabled states, role hierarchy, and computed `effective_enabled` / `effective_assistant_role` |
| `WorkspaceAssistantSettings` | `interface` | Workspace-level assistant config: enabled, max/default roles, OpenAI override status |
| `getEffectiveAssistantSettings` | `(workspaceId, environmentId) => Promise<EffectiveAssistantSettings>` | Resolves full effective settings for an environment |
| `getWorkspaceAssistantSettings` | `(workspaceId) => Promise<WorkspaceAssistantSettings>` | Reads workspace-level Flashi configuration |
| `getWorkspaceOpenAiOverrides` | `(workspaceId) => Promise<{ apiKey: string \| null; model: string \| null }>` | Decrypts and returns any workspace-level OpenAI API key / model overrides |
| `setWorkspaceAssistantSettings` | `(workspaceId, updates) => Promise<void>` | Updates workspace-level assistant settings (enabled, roles, OpenAI key/model) |
| `getEnvironmentAssistantApiKey` | `(workspaceId, environmentId) => Promise<string \| null>` | Decrypts and returns the environment's dedicated Flashi API key |
| `setEnvironmentAssistantEnabled` | `(environmentId, enabled, role?, actorUserId?) => Promise<void>` | Toggles environment assistant, manages dedicated API key lifecycle |

## Interfaces

### `EffectiveAssistantSettings`

```typescript
{
  platform_assistant_enabled: boolean;
  workspace_assistant_enabled: boolean;
  workspace_assistant_max_role: WorkspaceRole;
  workspace_assistant_default_role: WorkspaceRole;
  environment_assistant_role: WorkspaceRole;
  effective_assistant_role: WorkspaceRole;
  environment_assistant_enabled: boolean;
  effective_enabled: boolean;
}
```

### `WorkspaceAssistantSettings`

```typescript
{
  platform_assistant_enabled: boolean;
  workspace_assistant_enabled: boolean;
  workspace_assistant_max_role: WorkspaceRole;
  workspace_assistant_default_role: WorkspaceRole;
  workspace_openai_override_configured: boolean;
  workspace_openai_model: string | null;
}
```

## Key Logic

### `getEffectiveAssistantSettings`

1. Reads `assistant_enabled` from `platform_settings` via `getPlatformSettings()`.
2. Reads workspace-level settings via `getWorkspaceAssistantSettings()` (enabled, max_role, default_role).
3. Reads `enterprise_features.assistant` from the `environments` table (JSONB column, scoped by both `environment_id` and `workspace_id`).
4. Clamps the environment's role to the workspace's `max_role` ceiling.
5. Returns `effective_enabled = platform AND workspace AND environment`.
6. Errors in environment setting resolution are logged as warnings but default to `disabled` — never breaks the resolution flow.

### `setEnvironmentAssistantEnabled`

Uses a database transaction to atomically:

1. Reads current `enterprise_features` JSONB from the `environments` table (`SELECT ... FOR UPDATE`).
2. When **enabling**: checks for an existing valid API key (not revoked, not expired, matching role). Reuses if valid, otherwise revokes the old key and creates a new environment-scoped API key in `api_keys`.
3. When **disabling**: revokes any existing dedicated API key.
4. Writes the updated `{ assistant: { enabled, role, api_key_id? } }` back into `enterprise_features`.

### `setWorkspaceAssistantSettings`

Reads the workspace's `settings` JSONB, updates the `flashagent` sub-object with any of:
- `assistant_enabled` — toggle
- `max_role` / `default_role` — role boundaries (clamped to `admin` ceiling, default clamped to max)
- `openai_api_key` — encrypted with `workspace-flashagent:{workspaceId}` context
- `clear_openai_api_key` — removes the encrypted key
- `openai_model` — model override (max 120 chars)

### `getWorkspaceOpenAiOverrides`

Decrypts the workspace's stored OpenAI API key using `decrypt()` with the `workspace-flashagent:{workspaceId}` context. Returns `{ apiKey, model }`, both nullable.

### `getEnvironmentAssistantApiKey`

Resolves the environment's dedicated Flashi API key:
1. Reads `enterprise_features.assistant.api_key_id` from the environment.
2. Looks up the key in `api_keys` (scoped to `environment`, matching workspace and environment).
3. Validates not revoked and not expired.
4. Decrypts `token_enc` using the `api-key:{keyId}` context.

## Role Hierarchy

Roles are ordered: `viewer < member < admin < owner`. The `owner` role is normalised to `admin` for Flashi purposes. Environment roles are always clamped to the workspace's `max_role` ceiling via `clampRoleToCeiling()`.

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute`, `queryOne`, `transaction` | `./db` | Database operations |
| `decrypt`, `encrypt`, `generateToken`, `hashToken` | `./crypto` | API key encryption/decryption |
| `getPlatformSettings` | `./platform-settings` | Platform-level feature gate |
| `WorkspaceRole` | `./rbac` | Role type |
