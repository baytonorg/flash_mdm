# `src/api/queries/signupLinks.ts`

> React Query hooks for creating, updating, deleting, and resolving invitation/signup links for workspace or environment onboarding.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `SignupLink` | `interface` | Signup link with scope, slug, role defaults, auto-assign environments/groups, allowed domains, display fields |
| `ResolvedSignupLink` | `interface` | Public-facing resolved link info (scope, names, role, allowed domains) for the signup page |
| `signupLinkKeys` | `object` | Query key factory: `all`, `byScope(scopeType, scopeId)`, `resolve(slugOrToken)` |
| `useSignupLink` | `(scopeType, scopeId) => UseQueryResult<SignupLink \| null>` | Fetches the signup link for a scope (returns null if none exists) |
| `useCreateSignupLink` | `() => UseMutationResult<{signup_link, token}>` | Creates a signup link; returns the link and its token |
| `useUpdateSignupLink` | `() => UseMutationResult` | Updates a signup link via PATCH |
| `useDeleteSignupLink` | `() => UseMutationResult` | Deletes a signup link |
| `useResolveSignupLink` | `(slugOrToken) => UseQueryResult<ResolvedSignupLink>` | Resolves a slug or token to its public signup link info; `retry: false` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- Signup links can be scoped to a `workspace` or `environment` and support custom slugs for friendly URLs.
- `auto_assign_environment_ids` and `auto_assign_group_ids` automatically grant new users access to specific environments and groups upon signup.
- `useResolveSignupLink` is used on the public signup page and disables retries to fail fast for invalid tokens.
- `useUpdateSignupLink` uses PATCH (not PUT) to allow partial updates.
