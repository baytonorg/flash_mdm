# `netlify/functions/flashagent-chat.ts`

> Main Flashi AI assistant chat endpoint. Accepts a user message, runs the OpenAI tool-calling loop with AMAPI MCP and Flash internal tools (including CSV export generation), and returns the assistant reply.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (handler) | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `requireAuth` | `_lib/auth` | Authenticate the caller |
| `requireWorkspaceResourcePermission`, `requireEnvironmentAccessScope`, `getEffectivePermissionMatrixForWorkspace` | `_lib/rbac` | Permission and scope checks |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `isValidUuid`, `assertSameOriginRequest`, `getClientIp`, `retryAfterHeader` | `_lib/helpers` | Request/response utilities |
| `queryOne` | `_lib/db` | Database lookups |
| `getEffectiveAssistantSettings` | `_lib/flashagent-settings` | Feature gate resolution |
| `checkAssistantEntitlement` | `_lib/flashagent-billing` | Billing entitlement check |
| `buildSystemPrompt` | `_lib/flashagent-prompt` | System prompt construction |
| `runFlashi` | `_lib/flashagent-runtime` | Tool-calling loop execution |
| `logAudit` | `_lib/audit` | Audit trail |
| `consumeToken` | `_lib/rate-limiter` | Rate limiting |
| `resolveAccessTokenAndProject` | `_lib/workspace-credentials` | Mints Google access token for AMAPI tools |

## Key Logic

### POST (send message)

1. Validates `environment_id` (UUID) and `message` (string, max 12000 chars).
2. Resolves environment → workspace in a single JOIN query (`environments JOIN workspaces`) returning `workspace_id`, environment `name`, `enterprise_name`, `enterprise_display_name`, and `workspace_name`. Returns 403 (not 404) to prevent environment existence oracle.
3. RBAC: `flashagent:read` on workspace.
4. Rate limits by IP and principal+environment, with cost scaling by message length.
5. Feature gate: checks `getEffectiveAssistantSettings()` (platform AND workspace AND environment must be enabled).
6. Billing entitlement: checks `checkAssistantEntitlement()` (soft hook, currently permissive).
7. Resolves user's access scope, role, and AMAPI credentials (Google service account).
8. Builds context messages (last 10, capped at 1000 chars each) and system prompt (with `workspaceId` and `environmentId` passed to `buildSystemPrompt`).
9. Runs `runFlashi()` tool-calling loop with full runtime context.
10. Audit logs the interaction (tool call count, message/reply lengths).

### Request body

```typescript
{
  message: string;           // User message (max 12000 chars)
  environment_id: string;    // UUID of the target environment
  contextMessages?: Array<{ role: string; text: string }>;  // Previous conversation
}
```

### Response

```json
{ "reply": "...", "role": "assistant", "source": "none|mcp|api|mixed" }
```

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/flashagent/chat` | Session / API key (flashagent:read) | Send a message to Flashi |
