# `netlify/functions/_lib/helpers.ts`

> Common HTTP request/response utilities: JSON responses, CSRF protection, UUID validation, client IP extraction, and request body parsing.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `jsonResponse` | `(data: unknown, status?: number, headers?: Record<string, string>) => Response` | Creates a JSON `Response` with optional status and headers |
| `markApiKeyAuthenticatedRequest` | `(request: Request) => void` | Marks a request as API-key-authenticated using a Symbol property |
| `isApiKeyAuthenticatedRequest` | `(request: Request) => boolean` | Checks if a request has been marked as API-key-authenticated |
| `attachAuditAuthContextToRequest` | `(request: Request, ctx: AuditRequestAuthContext) => void` | Attaches audit auth context to a request object via a Symbol property |
| `getAuditAuthContextFromRequest` | `(request: Request) => AuditRequestAuthContext \| undefined` | Retrieves the audit auth context attached to a request |
| `errorResponse` | `(message: string, status?: number) => Response` | Shorthand for `jsonResponse({ error: message }, status)`, defaults to 400 |
| `isValidUuid` | `(value: string) => boolean` | Validates a string as a UUID v1-v5 format |
| `assertSameOriginRequest` | `(request: Request) => void` | Throws 403 if the request `Origin` header doesn't match the request URL origin; skips check for API key requests |
| `getClientIp` | `(request: Request) => string` | Extracts client IP from `x-forwarded-for` or `x-real-ip` headers, falling back to `'unknown'` |
| `parseJsonBody` | `<T>(request: Request) => Promise<T>` | Parses JSON request body; enforces same-origin check on mutations for non-API-key requests. Throws 400 on invalid JSON |
| `getSearchParams` | `(request: Request) => URLSearchParams` | Returns the URL search params from the request URL |
| `sleep` | `(ms: number) => Promise<void>` | Async sleep utility for delays and retry backoff |
| `retryAfterHeader` | `(retryAfterMs?: number) => Record<string, string>` | Builds a `Retry-After` header object from a millisecond value; returns empty object if absent |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `setCurrentAuditAuthContext`, `AuditRequestAuthContext` | `_lib/request-auth-context.ts` | Refreshing AsyncLocalStorage context when extracting client IP |

## Key Logic

**Symbol-based request markers**: API key authentication status and audit context are stored on the `Request` object using unique Symbols, preventing accidental access or collision with other properties.

**CSRF protection** (`assertSameOriginRequest`): Compares the `Origin` header against the request URL's origin. Requests without an `Origin` header are allowed through (covers same-origin GETs and non-browser clients). The `origin: 'null'` case is explicitly rejected.

**Client IP extraction** (`getClientIp`): Also refreshes the AsyncLocalStorage audit context from the request-attached context, working around a Netlify runtime issue where AsyncLocalStorage context can be lost across certain `await` boundaries.
