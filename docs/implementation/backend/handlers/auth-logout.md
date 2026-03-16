# `netlify/functions/auth-logout.ts`

> Destroys the current session by deleting it from the database and clearing the session cookie.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute` | `_lib/db.js` | Database execute for deleting the session row |
| `getSessionTokenFromCookie`, `clearSessionCookie` | `_lib/auth.js` | Extract session token from cookie and build a clearing cookie header |
| `hashToken` | `_lib/crypto.js` | Hash the session token for DB lookup |
| `jsonResponse`, `errorResponse` | `_lib/helpers.js` | Standardised HTTP response builders |

## Key Logic

1. Rejects non-POST requests with 405.
2. Reads the session token from the request cookie.
3. If a token is present, hashes it and deletes the matching row from `sessions`.
4. Returns `{ message: "Logged out" }` with a `Set-Cookie` header that clears the session cookie.
5. Works gracefully even if no session token is present (still clears the cookie).

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/auth-logout` | Cookie (best-effort) | Log out the current user |
