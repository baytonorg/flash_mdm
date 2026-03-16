# `netlify/functions/flashagent-settings.ts`

> Reads and updates the Flashi assistant enabled state and role for an environment. The effective state is determined by the platform-level toggle, the workspace-level toggle, and the per-environment toggle. Role is clamped to the workspace's max_role ceiling.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (handler) | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `requireAuth` | `_lib/auth` | Authenticate the caller |
| `requireEnvironmentAccessScopeForResourcePermission`, `requireEnvironmentResourcePermission` | `_lib/rbac` | Environment-scoped permission checks |
| `queryOne` | `_lib/db` | Database lookups |
| `getEffectiveAssistantSettings`, `getWorkspaceAssistantSettings`, `setEnvironmentAssistantEnabled` | `_lib/flashagent-settings` | Settings resolution and update |
| `logAudit` | `_lib/audit` | Audit trail |
| `sanitizeErrorForLog` | `_lib/log-safety` | Safe error logging |

## Key Logic

### GET (read settings)

1. Validates `environment_id` from query params.
2. Resolves environment → workspace.
3. RBAC: `flashagent:read` (environment-scoped).
4. Returns the full effective settings including role hierarchy.

### PUT (toggle environment assistant)

1. API keys are forbidden (`auth.authType === "api_key"` → 403).
2. Validates `environment_id` (UUID), `enabled` (boolean), and optional `role` (one of `viewer`, `member`, `admin`).
3. RBAC: `flashagent:manage_settings` (admin role required).
4. Resolves workspace settings to determine the `max_role` ceiling.
5. Clamps the requested role (or workspace default_role) to the ceiling.
6. Calls `setEnvironmentAssistantEnabled(environmentId, enabled, effectiveRole, auth.user.id)` which manages the environment's dedicated API key lifecycle.
7. Re-fetches effective settings and audit logs the change (including role information).

### Request body (PUT)

```typescript
{
  environment_id: string;   // UUID of the target environment
  enabled: boolean;         // Toggle Flashi on/off
  role?: WorkspaceRole;     // Optional: "viewer" | "member" | "admin" — clamped to workspace max_role
}
```

## Response Shape

```json
{
  "environment_id": "uuid",
  "platform_assistant_enabled": true,
  "workspace_assistant_enabled": true,
  "workspace_assistant_max_role": "admin",
  "workspace_assistant_default_role": "viewer",
  "environment_assistant_role": "member",
  "effective_assistant_role": "member",
  "environment_assistant_enabled": true,
  "effective_enabled": true
}
```

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/flashagent/settings` | Session / API key (flashagent:read) | Get effective assistant settings |
| `PUT` | `/api/flashagent/settings` | Session only (flashagent:manage_settings) | Toggle environment assistant and set role |
