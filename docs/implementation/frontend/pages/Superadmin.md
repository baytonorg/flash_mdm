# `src/pages/Superadmin.tsx`

> Platform administration pages for superadmins covering dashboard stats, workspace management, user management, and platform statistics.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `SuperadminDashboard` | `React.FC` | Platform overview with stats, platform settings, plan catalogue, and recent signups |
| `SuperadminWorkspaces` | `React.FC` | Workspace list with drill-down detail view, impersonation, licensing, grants, and billing |
| `SuperadminUsers` | `React.FC` | Platform-wide user list with search, superadmin toggle, access assignments, and delete |
| `SuperadminStats` | `React.FC` | Extended platform statistics and function logs |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | All superadmin API calls |
| `LicenseStatusResponse` (type) | `@/api/queries/licenses` | Workspace license status type |
| `parseMajorInputToMinorUnits` | `@/utils/currency` | Currency conversion for plan pricing |
| `formatDate` | `@/utils/format` | Date formatting |
| `DURATION_MONTH_OPTIONS`, `normalizeBillingDurationMonths` | `@/constants/billing` | Billing interval constants |
| `WorkspaceLicenseSettingsResponse` (type) | `@/types/licensing` | Workspace license settings type |
| `UserAccessAssignmentsModal` | `@/components/users/UserAccessAssignmentsModal` | User access editing modal |
| `LivePageIndicator` | `@/components/common/LivePageIndicator` | Auto-refresh indicator badge |

## Key Logic

**SuperadminDashboard**: Displays four stat cards (workspaces, environments, devices, users) with 5-second live refresh. Provides platform access controls (invite-only toggle, licensing toggle), default free tier settings, a database migrations runner, and a full plan catalogue editor. Plans support inline editing of name, unit amount, currency, Stripe price ID, billing interval, and visibility. New plans can be added with optional automatic Stripe price creation.

**SuperadminWorkspaces**: Paginated, searchable workspace list. Selecting a workspace shows a detail panel with environments, users (with role badges), active support/impersonation sessions, support audit log, license status, grant ledger, and invoice queue. Actions include: disable/enable workspace, force plan change, impersonate user (with support reason, ticket ref, and notice acknowledgment), invite user to workspace, create workspace, issue manual seat grants (with duration and expiry options), workspace free tier overrides, and mark invoices as paid.

**SuperadminUsers**: Platform-wide paginated user list with search. Shows email, name, superadmin status, MFA status, last login, workspace count, and workspace details. Supports toggling superadmin status, managing user access assignments, and deleting users.

**SuperadminStats**: Extended platform statistics with Pub/Sub webhook event logs (notification type, device, status, raw preview) and derivative selection event logs (policy ID, scope, generation hash, reason code).
