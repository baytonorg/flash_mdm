# `src/pages/Groups.tsx`

> Hierarchical group management page with CRUD, bulk operations, policy assignment, and a detail drawer.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Groups` | `React.FC` (default) | Groups page component |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `getApiErrorStatus` | 14-19 | Extracts HTTP status code from an error object |
| `getApiErrorMessage` | 21-27 | Extracts a human-readable message from an error object |
| `getBulkWarningMessage` | 30-40 | Builds a user-facing warning message for bulk action errors, with special handling for 403 |
| `GroupModal` | 52-233 | Modal component for creating and editing groups with parent selection |
| `GroupDetailDrawer` | 602-745 | Slide-out drawer showing group detail, policy resolution chain, and policy override editor |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useContextStore` | `@/stores/context` | Accessing active environment |
| `useGroups`, `useCreateGroup`, `useUpdateGroup`, `useDeleteGroup`, `useBulkGroupAction`, `Group` | `@/api/queries/groups` | Group CRUD and bulk operations |
| `usePolicyAssignments` | `@/api/queries/policies` | Loading policy assignments for the detail drawer |
| `DataTable`, `ColumnDef` | `@/components/common/DataTable` | Rendering the hierarchical group table |
| `BulkActionBar`, `BulkAction` | `@/components/common/BulkActionBar` | Bulk action toolbar |
| `SelectAllMatchingNotice` | `@/components/common/SelectAllMatchingNotice` | "Select all" banner for bulk operations |
| `ConfirmModal` | `@/components/common/ConfirmModal` | Delete confirmation dialog |
| `PolicyAssignmentSelect` | `@/components/policy/PolicyAssignmentSelect` | Inline policy assignment in the table and drawer |
| `PolicyOverrideEditor` | `@/components/policy/PolicyOverrideEditor` | Policy override editing in the detail drawer |
| `useBulkSelection` | `@/hooks/useBulkSelection` | Row selection state management for bulk actions |

## Key Logic

The page displays groups as a hierarchical tree-ordered table (parent-first, children sorted by name, with depth-based indentation). Each row shows the group name, description, device count placeholder, an inline `PolicyAssignmentSelect`, and edit/delete action buttons. Clicking a row opens a `GroupDetailDrawer` that displays the group's effective policy (direct or inherited by walking up the parent chain to the environment level), a policy assignment selector, and a `PolicyOverrideEditor`. The `GroupModal` handles creation and editing, including parent group selection with indented options and a warning when reparenting would move an entire subtree. Bulk operations support "Move" (with target parent selection and optional assignment clearing) and "Delete", both using `useBulkGroupAction`. Error handling surfaces 403 permission errors with specific messages.
