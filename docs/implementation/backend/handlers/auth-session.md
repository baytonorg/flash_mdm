# `netlify/functions/auth-session.ts`

> Returns the current authenticated user's session information, or clears an environment-setup flag via POST.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `isDatabaseInfraError` | 6-25 | Detects database infrastructure errors (connection failures, compute quota, too many connections) by PG error code or message pattern matching |
| `authServiceUnavailableResponse` | 27-36 | Returns a 503 response with `AUTH_SERVICE_UNAVAILABLE` code and a 60-second `Retry-After` header |
| `getUserNeedsSetup` | 38-48 | Checks the user's `metadata` JSONB column for the `needs_environment_setup` flag |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `validateSession`, `requireSessionAuth` | `_lib/auth.js` | Session validation (soft and strict) |
| `queryOne`, `execute` | `_lib/db.js` | Database queries |
| `jsonResponse`, `errorResponse`, `parseJsonBody` | `_lib/helpers.js` | HTTP helpers |

## Key Logic

### GET -- Session Check
1. Validates the session cookie via `validateSession` (non-throwing). Returns 401 if invalid.
2. Checks the `needs_environment_setup` flag from user metadata.
3. Returns the user object with the setup flag appended.
4. On database infrastructure errors, returns 503 with `AUTH_SERVICE_UNAVAILABLE`.

### POST -- Clear Environment Setup Flag
1. Requires a valid session via `requireSessionAuth` (throws on failure).
2. Parses the body for `{ clear_environment_setup: true }`.
3. Removes the `needs_environment_setup` key from the user's `metadata` JSONB column.
4. Returns `{ message: "ok" }`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/.netlify/functions/auth-session` | Session cookie | Retrieve current user session and metadata |
| POST | `/.netlify/functions/auth-session` | Session cookie | Clear the environment-setup flag for the current user |
