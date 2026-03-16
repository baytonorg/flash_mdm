# `src/lib/redirect.ts`

> Safe in-app redirect utilities that prevent open-redirect vulnerabilities.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `sanitizeInAppRedirect` | `(value: string \| null \| undefined, fallback?: string) => string` | Validates and sanitizes a redirect path, returning the fallback for unsafe values |
| `redirectBrowserToInApp` | `(value: string \| null \| undefined, fallback?: string) => void` | Calls `window.location.assign` with the sanitized redirect path |

## Key Logic

- **`sanitizeInAppRedirect`**:
  - Returns `fallback` (default `'/'`) for null, undefined, or empty/whitespace-only values.
  - Accepts paths starting with `/` but rejects protocol-relative URLs (`//...`) and backslash variants (`/\...`).
  - For non-path values, parses as a URL relative to `window.location.origin` and rejects any URL whose origin differs from the current page.
  - On successful same-origin parse, returns only the pathname + search + hash (strips the origin).
  - Returns `fallback` on any URL parse error.
- **`redirectBrowserToInApp`**: Thin wrapper that pipes through `sanitizeInAppRedirect` then assigns the result to `window.location`.
