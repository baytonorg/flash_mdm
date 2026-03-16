# `src/components/settings/SignupLinkSettings.tsx`

> Manages the lifecycle of a signup link for a workspace or environment: creation, editing, enable/disable, regeneration, and deletion.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `SignupLinkSettings` | `default function` | Full signup link management panel |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `scopeType` | `'workspace' \| 'environment'` | Yes | Whether the link is scoped to a workspace or environment |
| `scopeId` | `string` | Yes | ID of the workspace or environment |
| `environments` | `EnvironmentLike[]` | No | Available environments for auto-assign (workspace scope only) |
| `groups` | `GroupLike[]` | No | Available groups for auto-assign (environment scope only) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `FeedbackMessage` | 23-41 | Sub-component rendering success (green) or error (red) feedback banners |
| `parseAllowedDomains` | 83-87 | Splits comma/space-separated domain string into array |
| `validateAllowedDomains` | 89-96 | Regex-validates each domain; returns error string or null |
| `getShareUrl` | 101-105 | Constructs the full share URL from slug or raw token |
| `handleCopy` | 107-113 | Copies the share URL to clipboard with 2-second feedback |
| `handleCreate` | 115-142 | Validates domains, calls `createLink.mutateAsync`, stores raw token |
| `handleRegenerate` | 144-172 | Invalidates old token and creates a new one |
| `handleToggleEnabled` | 174-183 | Toggles the link's enabled state via `updateLink` |
| `handleSaveSettings` | 185-214 | Persists edited settings (slug, role, domains, scope-specific fields) |
| `handleDelete` | 216-227 | Permanently revokes the signup link |
| `toggleEnvId` | 229-233 | Toggles an environment ID in the auto-assign selection |
| `toggleGroupId` | 235-239 | Toggles a group ID in the auto-assign selection |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useSignupLink`, `useCreateSignupLink`, `useUpdateSignupLink`, `useDeleteSignupLink` | `@/api/queries/signupLinks` | CRUD query hooks for signup links |
| `ConfirmModal` | `@/components/common/ConfirmModal` | Confirmation dialogs for regenerate and delete |

## Key Logic

The component renders two distinct states:

**No link exists** -- shows a creation form with: custom slug input (lowercase alphanumeric + hyphens), display name, description, default role (viewer/member/admin), allowed email domains, and scope-specific options. For workspace scope: access scope radio (workspace-wide vs scoped), allow environment creation checkbox, and environment auto-assign checkboxes. For environment scope: group auto-assign checkboxes.

**Link exists** -- shows a management UI with: active/disabled badge with toggle button, the share URL with copy button, all editable settings, a "Save Settings" button, and a danger zone with "Regenerate Token" and "Revoke Link" buttons (both guarded by `ConfirmModal`). The share URL is constructed as `/join/w/{slug}` for workspace or `/join/e/{slug}` for environment scope. Domain validation uses a regex pattern for standard domain format. State is synced from the fetched link via `useEffect` whenever the query data changes.
