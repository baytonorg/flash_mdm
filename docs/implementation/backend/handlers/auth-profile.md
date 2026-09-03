# `netlify/functions/auth-profile.ts`

> Updates the authenticated user's name and email address.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Description |
|------|-------------|
| `optionalName` | Normalises an optional first or last name, enforces the 100-character limit, and returns a validation response for non-string values |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne` | `_lib/db.js` | Updating and returning the user's profile |
| `requireSessionAuth` | `_lib/auth.js` | Enforcing session-cookie authentication; API keys are not accepted |
| `logAudit` | `_lib/audit.js` | Recording the profile update |
| `errorResponse`, `getClientIp`, `isValidEmail`, `jsonResponse`, `parseJsonBody` | `_lib/helpers.js` | Request validation, response formatting, and audit context |

## Key Logic

1. Rejects methods other than `PUT` with 405.
2. Requires an authenticated browser session.
3. Normalises first and last names, treating blank values as `null`, and rejects names longer than 100 characters.
4. Trims and lowercases the email address, rejecting invalid values and addresses longer than 255 characters.
5. Updates the current user's record and returns the refreshed session user shape.
6. Records an `auth.profile_updated` audit event without storing profile values in the event details.
7. Returns 409 when the normalised email address is already assigned to another account.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| PUT | `/api/auth/profile` | Session cookie | Update the authenticated user's first name, last name, and email address |
