# `netlify/functions/flashagent-chat-history.ts`

> Manages per-user, per-environment chat history persistence for Flashi. Supports loading, appending, exporting (markdown), and clearing messages.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (handler) | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Description |
|------|-------------|
| `pruneOldMessages` | Deletes messages older than `RETENTION_DAYS` for a user+environment |
| `formatChatHistoryMarkdown` | Formats messages as a downloadable Markdown document with date headings |
| `historyRateLimitedResponse` | Returns 429 with retry header |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `requireAuth` | `_lib/auth` | Authenticate the caller |
| `requireEnvironmentAccessScopeForResourcePermission` | `_lib/rbac` | Environment-scoped permission check |
| `execute`, `query`, `queryOne` | `_lib/db` | Database operations |
| `logAudit` | `_lib/audit` | Audit trail for DELETE |
| `consumeToken` | `_lib/rate-limiter` | Rate limiting (IP + principal) |
| `retryAfterHeader` | `_lib/helpers` | Builds `Retry-After` header from milliseconds |

## Key Logic

### GET (load history)

1. Validates `environment_id`, resolves environment (returns 403 if not found to prevent UUID enumeration).
2. RBAC: `flashagent:read` (environment-scoped).
3. Rate limits by IP (300/5min) and principal+environment (180/3min).
4. Returns messages ordered by `created_at ASC`, limited to 500 rows.
5. If `?format=markdown`, wraps output as `{ markdown, filename }` for download.

### POST (append messages)

1. Validates `environment_id` and `messages` array.
2. RBAC: `flashagent:read` (intentionally — users persist their own chat history).
3. Rate limits by IP (180/3min) and principal+environment (90/90s).
4. Prunes old messages, then caps total at `MAX_MESSAGES` (5000).
5. Bulk inserts with role normalization (`user` or `assistant`) and text truncation (8000 chars).

### DELETE (clear history)

1. RBAC: `flashagent:write` (requires admin role).
2. Rate limits by IP (20/10min) and principal+environment (10/10min).
3. Deletes all messages for the user+environment.
4. Audit logs the action.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `FLASHAGENT_CHAT_RETENTION_DAYS` | `30` | Auto-prune threshold in days |

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/flashagent/chat-history` | Session / API key (flashagent:read) | Load chat history |
| `POST` | `/api/flashagent/chat-history` | Session / API key (flashagent:read) | Append messages |
| `DELETE` | `/api/flashagent/chat-history` | Session / API key (flashagent:write) | Clear chat history |
