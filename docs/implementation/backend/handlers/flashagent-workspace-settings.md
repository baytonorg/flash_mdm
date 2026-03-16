# `netlify/functions/flashagent-workspace-settings.ts`

> Reads and updates workspace-level Flashi assistant configuration: enabled state, role boundaries (max_role, default_role), and optional OpenAI API key/model overrides.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (handler) | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `requireAuth` | `_lib/auth` | Authenticate the caller |
| `requireWorkspaceResourcePermission` | `_lib/rbac` | Workspace-scoped permission checks |
| `getWorkspaceAssistantSettings`, `setWorkspaceAssistantSettings` | `_lib/flashagent-settings` | Settings resolution and update |
| `logAudit` | `_lib/audit` | Audit trail |
| `sanitizeErrorForLog` | `_lib/log-safety` | Safe error logging |

## Key Logic

### GET (read workspace settings)

1. Validates `workspace_id` from query params (UUID).
2. RBAC: `workspace:read`.
3. Returns workspace-level assistant settings.

### PUT (update workspace settings)

1. API keys are forbidden (`auth.authType === "api_key"` → 403).
2. Validates `workspace_id` (UUID) and at least one setting field must be provided.
3. Validates role values are one of `viewer`, `member`, `admin`.
4. Validates `openai_api_key` max length (400 chars), `openai_model` max length (120 chars).
5. Cannot set and clear `openai_api_key` in the same request.
6. RBAC: `workspace:manage_settings`.
7. Calls `setWorkspaceAssistantSettings()` which encrypts API keys and persists to `workspaces.settings` JSONB.
8. Re-fetches settings and audit logs the change.

### Request body (PUT)

```typescript
{
  workspace_id: string;                // Required: UUID of the workspace
  assistant_enabled?: boolean;         // Toggle Flashi at workspace level
  max_role?: WorkspaceRole;            // Ceiling for environment roles ("viewer" | "member" | "admin")
  default_role?: WorkspaceRole;        // Default role for new environments
  openai_api_key?: string;             // Workspace-level OpenAI API key override (encrypted at rest)
  clear_openai_api_key?: boolean;      // Remove the stored OpenAI API key
  openai_model?: string | null;        // Model override (max 120 chars), null to clear
}
```

## Response Shape

```json
{
  "workspace_id": "uuid",
  "platform_assistant_enabled": true,
  "workspace_assistant_enabled": true,
  "workspace_assistant_max_role": "admin",
  "workspace_assistant_default_role": "viewer",
  "workspace_openai_override_configured": false,
  "workspace_openai_model": null
}
```

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/flashagent/workspace-settings` | Session / API key (workspace:read) | Get workspace assistant settings |
| `PUT` | `/api/flashagent/workspace-settings` | Session only (workspace:manage_settings) | Update workspace assistant settings |
