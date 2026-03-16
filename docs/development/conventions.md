# Engineering conventions

## Principles
- Parameterized SQL only — never interpolate user input into queries
- Defense-in-depth validation: UUID format, RBAC checks, and workspace/tenant isolation on every request
- Prefer idempotency for webhooks and background jobs

## RBAC roles
Workspace roles in ascending privilege order: `viewer`, `member`, `admin`, `owner`. There is also a `superadmin` platform role enforced separately. The `_lib/rbac.ts` module exports the role hierarchy and permission matrix.

## Error handling
- Public endpoints must not leak internal DB errors to callers
- Audit log should capture actor, intent, and outcome for all mutating operations

## Logging
- Server-side logs are available via the Netlify dashboard and via the Superadmin UI
