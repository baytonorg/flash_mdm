# `netlify/functions/auth-register.ts`

> Registers a new user account with support for bootstrap (first user), self-signup, invite-based onboarding, and signup-link registration.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `sanitizeRedirectPath` | 484-488 | Validates that a redirect path starts with `/` and is not a protocol-relative URL |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute`, `transaction` | `_lib/db.js` | Database queries and transactional user/workspace creation |
| `generateToken`, `hashToken` | `_lib/crypto.js` | Token generation and hashing |
| `sendEmail`, `magicLinkEmail` | `_lib/resend.js` | Email delivery and magic-link email template |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP helpers |
| `hashPassword` | `auth-login.js` | Password hashing (imported from sibling handler) |
| `consumeToken` | `_lib/rate-limiter.js` | Token-bucket rate limiting |
| `getPlatformSettings` | `_lib/platform-settings.js` | Checks invite-only registration setting |
| `setSessionCookie`, `SESSION_MAX_AGE_MILLISECONDS` | `_lib/auth.js` | Session cookie for invite-onboarding direct login |
| `MIN_PASSWORD_LENGTH`, `MAX_PASSWORD_LENGTH` | `_lib/password-policy.js` | Password length constraints |
| `upsertWorkspaceMembershipFromInvite`, `getInviteForAccept`, `parseJsonStringArray`, `getInviteTypeFromPermissions` | `workspace-invite.js` | Invite acceptance helpers |

## Key Logic

1. Rejects non-POST requests with 405.
2. Validates required fields (`email`, `password`, `first_name`, `last_name`) and password length.
3. **Rate limiting**: per-IP, 3 registrations per hour.
4. **First-user bootstrap**: checks user count. First user becomes `is_superadmin`. If `BOOTSTRAP_SECRET` env var is set, the request must include a matching `x-bootstrap-secret` header (timing-safe comparison).
5. **Invite resolution**: if the redirect path starts with `/invite/`, looks up a pending invite for the email.
6. **Signup link resolution**: if `signup_link_token` is provided, resolves it by token hash or slug. Validates email domain against allowed domains if configured.
7. **Invite-only gate**: when `invite_only_registration` is enabled in platform settings, blocks registration unless there is a pending invite or a valid signup link. First-user bootstrap bypasses this gate.
8. **Existing user check**: returns a generic 201 response (with dummy hash work) to prevent enumeration.
9. **Transaction** (with advisory lock `pg_advisory_xact_lock(42)` to prevent first-user race conditions):
   - Creates the user row.
   - **Workspace invite onboarding**: accepts the invite, creates workspace/environment/group memberships per invite permissions.
   - **Signup link**: creates workspace membership (workspace-scoped or environment-scoped), auto-assigns environments and groups per link configuration, optionally flags user for environment setup.
   - **Self-signup**: creates a workspace, default environment, root group with closure table entry, and full admin memberships.
10. **Post-transaction**:
    - For workspace invite onboarding: creates a session directly (no magic link) and returns with `Set-Cookie`.
    - For all other flows: sends a magic-link email for first login and returns 201.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/auth-register` | None (optional `x-bootstrap-secret` header for first user) | Register a new user account |
