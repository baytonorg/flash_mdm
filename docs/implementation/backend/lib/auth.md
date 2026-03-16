# `netlify/functions/_lib/auth.ts`

> Session and API key authentication with CSRF protection, impersonation support, and sliding session expiration.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `SessionUser` | `interface` | Shape of an authenticated user including workspace/environment context and optional impersonation details |
| `AuthContext` | `interface` | Wraps `SessionUser` with session ID, auth type (`session` or `api_key`), and optional `ApiKeyAuthContext` |
| `ApiKeyAuthContext` | `interface` | Metadata for an authenticated API key: scope, role, creator info |
| `getSessionTokenFromCookie` | `(request: Request) => string \| null` | Extracts the `flash_session` cookie value from a request |
| `getSessionIdFromCookie` | `(request: Request) => string \| null` | Deprecated alias for `getSessionTokenFromCookie` |
| `validateSession` | `(request: Request) => Promise<AuthContext \| null>` | Validates the session cookie against the database, returns auth context or null |
| `requireAuth` | `(request: Request) => Promise<AuthContext>` | Validates session or API key; throws 401 if neither is valid. Enforces CSRF and read-only impersonation rules |
| `requireSuperadmin` | `(request: Request) => Promise<AuthContext>` | Calls `requireAuth`, then throws 403 unless user is a session-based superadmin |
| `requireSessionAuth` | `(request: Request) => Promise<AuthContext>` | Calls `requireAuth`, then throws 403 unless auth type is `session` |
| `setSessionCookie` | `(sessionId: string) => string` | Returns a `Set-Cookie` header value for setting the session cookie |
| `clearSessionCookie` | `() => string` | Returns a `Set-Cookie` header value that clears the session cookie |
| `SESSION_MAX_AGE_SECONDS` | `number` | Session TTL: 1,209,600 (14 days) |
| `SESSION_MAX_AGE_MILLISECONDS` | `number` | Session TTL in milliseconds |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `isMissingColumnError` | 54-61 | Checks if a Postgres error is code `42703` (undefined column), used for graceful schema migration fallback |
| `getApiKeyFromRequest` | 214-222 | Extracts API key from `Authorization: Bearer` header or `x-api-key` header |
| `validateApiKey` | 224-311 | Validates an API key token against `api_keys` table, updates `last_used_at`, returns auth context or null |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute` | `_lib/db.ts` | Database queries for session and API key validation |
| `hashToken` | `_lib/crypto.ts` | Hashing session tokens and API keys before DB lookup |
| `assertSameOriginRequest`, `attachAuditAuthContextToRequest`, `markApiKeyAuthenticatedRequest` | `_lib/helpers.ts` | CSRF protection and request-level audit context attachment |
| `setCurrentAuditAuthContext` | `_lib/request-auth-context.ts` | Setting the async-local audit auth context for downstream audit logging |

## Key Logic

Authentication follows a two-step fallback: session cookie is checked first, then API key headers. Session tokens are stored as SHA-256 hashes in the database.

**Sliding expiration**: When a valid session has 7 or fewer days remaining (of a 14-day max), its expiry is extended to a fresh 14-day window. Renewal failures are logged but do not block the request.

**CSRF protection on mutations**: For mutating requests (`POST`/`PUT`/`PATCH`/`DELETE`), session-based auth requires both a same-origin check and an `X-Requested-With: XMLHttpRequest` header. API key requests skip CSRF checks but are marked on the request object for downstream logic.

**Read-only impersonation**: When a session is an impersonation session in `read_only` mode, mutating requests are blocked with a 403, except for the `/api/auth/logout` endpoint.

**Schema migration fallback**: The session query attempts to read impersonation and environment columns. If these columns don't exist yet (Postgres error `42703`), it falls back to a simpler query with NULL values, allowing the app to function during incremental migrations.
