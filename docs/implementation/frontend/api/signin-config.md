# `src/api/queries/signin-config.ts`

> React Query hooks for managing Google Sign-In enrollment configuration per environment.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `SigninConfig` | `interface` | Sign-in config: enabled flag, allowed domains, default group, personal usage setting, AMAPI token/QR |
| `signinConfigKeys` | `object` | Query key factory: `all` and `detail(environmentId)` |
| `useSigninConfig` | `(environmentId) => UseQueryResult<SigninConfig>` | Fetches the sign-in enrollment config for an environment |
| `useUpdateSigninConfig` | `() => UseMutationResult` | Updates sign-in config (enabled, allowed domains, default group, personal usage, token tag) |
| `useDeleteSigninConfig` | `() => UseMutationResult` | Deletes the sign-in config for an environment |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- Sign-in enrollment allows users to enroll devices by signing in with their Google account, restricted to `allowed_domains`.
- The config includes AMAPI-generated fields: `amapi_signin_enrollment_token` and `amapi_qr_code` for QR-based enrollment.
- `token_tag` is used to tag the AMAPI enrollment token for identification.
