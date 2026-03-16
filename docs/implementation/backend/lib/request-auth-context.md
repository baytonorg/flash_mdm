# `netlify/functions/_lib/request-auth-context.ts`

> AsyncLocalStorage-based per-request audit authentication context, providing ambient access to the current user/API key identity for audit logging.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `AuditRequestAuthContext` | `interface` | Shape of the audit context: auth type, user (id, email), and optional API key metadata |
| `setCurrentAuditAuthContext` | `(ctx: AuditRequestAuthContext) => void` | Sets the audit auth context for the current async scope using `enterWith` |
| `getCurrentAuditAuthContext` | `() => AuditRequestAuthContext \| undefined` | Retrieves the current audit auth context from AsyncLocalStorage, if set |
| `runWithAuditAuthContext` | `<T>(ctx: AuditRequestAuthContext, fn: () => Promise<T> \| T) => Promise<T>` | Executes a function within a scoped audit auth context using `run` |

## Key Logic

Uses Node.js `AsyncLocalStorage` to propagate authentication context through the async call stack without explicit parameter passing. This allows audit logging functions anywhere in the request lifecycle to access the authenticated user's identity.

Two patterns are supported:
- `setCurrentAuditAuthContext` uses `enterWith` to set context for the remainder of the current async scope (used by `requireAuth` in `auth.ts`)
- `runWithAuditAuthContext` uses `run` to scope context to a specific callback, providing cleaner isolation
