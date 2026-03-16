# `netlify/functions/_lib/html.ts`

> HTML entity escaping utility to prevent XSS in server-rendered output.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `escapeHtml` | `(value: unknown) => string` | Converts a value to string and escapes `&`, `<`, `>`, `"`, and `'` to their HTML entity equivalents |

## Key Logic

Accepts any value (coercing `null`/`undefined` to empty string via `String(value ?? '')`), then replaces the five standard HTML-sensitive characters with their entity references. Used when interpolating user-supplied data into HTML responses.
