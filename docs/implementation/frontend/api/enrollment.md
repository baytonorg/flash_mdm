# `src/api/queries/enrollment.ts`

> React Query hooks for managing device enrollment tokens -- listing, creating, syncing with AMAPI, deleting, and bulk operations.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `EnrollmentToken` | `interface` | Enrollment token record with QR data, policy/group assignment, expiry, etc. |
| `enrollmentKeys` | `object` | Query key factory: `all` and `list(environmentId)` |
| `useEnrollmentTokens` | `(environmentId: string) => UseQueryResult<EnrollmentToken[]>` | Lists enrollment tokens for an environment |
| `useCreateEnrollmentToken` | `() => UseMutationResult` | Creates a new enrollment token with optional policy and name |
| `useSyncEnrollmentTokens` | `() => UseMutationResult` | Syncs local tokens with AMAPI; returns imported/invalidated/total counts |
| `useDeleteEnrollmentToken` | `() => UseMutationResult` | Deletes a single enrollment token by id |
| `useBulkEnrollmentAction` | `() => UseMutationResult` | Bulk delete tokens by ids or all-matching with exclusions |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- The API uses British spelling (`/api/enrolment/`) for endpoint paths.
- `useSyncEnrollmentTokens` triggers a server-side reconciliation that imports missing AMAPI tokens and invalidates stale local ones.
- Bulk operations support `ids` selection, `all_matching` with `excluded_ids` for flexible batch targeting.
