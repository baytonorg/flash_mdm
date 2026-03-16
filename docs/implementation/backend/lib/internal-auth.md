# `netlify/functions/_lib/internal-auth.ts`

> Authenticates internal/scheduled function calls using a shared secret to prevent unauthorized external invocation.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `requireInternalCaller` | `(request: Request) => void` | Validates that the request is from an internal caller; throws a 401 `Response` if not |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `unauthorized` | 3-8 | Creates a 401 JSON error response |

## Key Logic

Internal authentication checks the `x-internal-secret` request header against the `INTERNAL_FUNCTION_SECRET` environment variable using `crypto.timingSafeEqual` to prevent timing attacks.

**Development/test fallback**: If `INTERNAL_FUNCTION_SECRET` is not configured, the function allows calls from localhost (`127.0.0.1`, `::1`) or when `NODE_ENV=test` / `NETLIFY_DEV=true`. In production without the env var configured, all calls are rejected.

**Secret comparison**: Both the provided and expected values are converted to Buffers and compared with `timingSafeEqual`. Length is checked first since `timingSafeEqual` requires equal-length buffers.
