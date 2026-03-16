# `src/pages/Policies.tsx`

> Lists and manages policies for the active environment with filtering, search, bulk actions, and delete.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Policies` | `React.FC` (default) | Policy list page component |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `Policies` | 48-391 | Main page component with policy table, filters, bulk actions, and delete modal |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | API calls for fetching and deleting policies |
| `useContextStore` | `@/stores/context` | Active environment access |
| `DataTable`, `ColumnDef` (type) | `@/components/common/DataTable` | Sortable data table component |
| `BulkActionBar`, `BulkAction` (type) | `@/components/common/BulkActionBar` | Floating bulk action toolbar |
| `SelectAllMatchingNotice` | `@/components/common/SelectAllMatchingNotice` | "Select all matching" notice |
| `useBulkSelection` | `@/hooks/useBulkSelection` | Checkbox selection state management |
| `useBulkPolicyAction` | `@/api/queries/policies` | Bulk policy operations mutation |

## Key Logic

The page fetches all policies for the active environment via `apiClient.get` with React Query. It supports three filtering dimensions: status (draft/production/archived), deployment scenario (fully managed/work profile/dedicated), and free-text search by name/description. Filters are applied client-side with `useMemo`.

Policies are displayed in a `DataTable` with columns for name, scenario badge, status badge, version, device count, and last updated date. Clicking a row navigates to the policy editor at `/policies/{id}`.

Bulk actions include copy, delete, set draft, set production, and push to AMAPI. These are dispatched through `useBulkPolicyAction` and display a confirmation dialog before execution. Individual deletion uses a modal confirmation dialog.

The "Default" policy is protected from deletion (the delete button is hidden). State resets when the environment changes.
