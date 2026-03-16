# Bootstrap and initial access

This page documents how a fresh Flash MDM deployment is initially accessed and secured.

## First user bootstrap

Flash MDM has a first-user bootstrap behavior:

- The very first registered user (when the `users` table is empty) is automatically granted `is_superadmin = true`.
- To prevent an unintended “first user wins” scenario, set `BOOTSTRAP_SECRET` before the first registration.

### `BOOTSTRAP_SECRET`

If `BOOTSTRAP_SECRET` is set and the user being created is the first user:

- the registration request must include the header `x-bootstrap-secret: <value>`
- the secret is compared using a timing-safe comparison

If the header is absent or does not match, registration is rejected with `403`.

Source: `netlify/functions/auth-register.ts`

## Invite-only registration

Self-serve registration can be disabled at the platform level after the initial superadmin is created.

As-built behavior:

- the platform setting `invite_only_registration` blocks self-serve registration
- invites and signup links bypass this gate (the invite/link itself acts as authorization)

Source: `netlify/functions/auth-register.ts`

## Operator guidance

1. Set `BOOTSTRAP_SECRET` before the site goes live.
2. Register the first superadmin account (include `x-bootstrap-secret` in the request or configure your client accordingly).
3. Remove `BOOTSTRAP_SECRET` from environment variables after the account is created.
4. Enable invite-only registration for enterprise deployments.

## Security note

Because the hosting operator has ultimate authority, access to:

- the Netlify account
- the database
- environment variables

must be tightly controlled. Anyone with access to these can read or modify any data in the system.
