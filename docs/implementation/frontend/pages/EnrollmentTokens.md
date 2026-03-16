# `src/pages/EnrollmentTokens.tsx`

> Enrollment token management page with creation, sync, QR preview, bulk selection, and deletion.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `EnrollmentTokens` | `React.FC` (default) | Enrollment tokens page component |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `formatDate` | 21-29 | Formats a date string to a locale-specific short date/time |
| `isExpired` | 31-34 | Checks whether a token's expiry date is in the past |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `enrollmentKeys`, `useBulkEnrollmentAction`, `useDeleteEnrollmentToken`, `useEnrollmentTokens`, `useSyncEnrollmentTokens`, `EnrollmentToken` | `@/api/queries/enrollment` | Token CRUD, sync, and bulk operations |
| `useContextStore` | `@/stores/context` | Accessing active environment |
| `BulkActionBar`, `BulkAction` | `@/components/common/BulkActionBar` | Bulk action toolbar |
| `ConfirmModal` | `@/components/common/ConfirmModal` | Delete confirmation dialog |
| `SelectAllMatchingNotice` | `@/components/common/SelectAllMatchingNotice` | "Select all" banner for bulk operations |
| `TableLoadingState` | `@/components/common/TableLoadingState` | Loading skeleton for the table |
| `TokenCreator` | `@/components/enrollment/TokenCreator` | Modal for creating new enrollment tokens |
| `EnrollmentQrPreview` | `@/components/enrollment/EnrollmentQrPreview` | QR code rendering for token payloads |
| `useBulkSelection` | `@/hooks/useBulkSelection` | Row selection state management |

## Key Logic

The page lists all enrollment tokens for the active environment in a custom table (not DataTable) with columns for name, group, one-time use flag, expiry, creation date, and a delete action. Clicking a token row opens a detail overlay showing QR code, token metadata (one-time use, expiry, group, policy), token value, and QR payload with copy-to-clipboard buttons. The "Sync from AMAPI" button triggers `useSyncEnrollmentTokens` to import tokens from the upstream AMAPI and reports the result in a transient toast. The "Create Token" button opens a `TokenCreator` modal. Bulk selection with `useBulkSelection` enables bulk delete via `useBulkEnrollmentAction`. Expired tokens are visually highlighted in red.
