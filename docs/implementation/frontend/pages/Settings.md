# `src/pages/Settings.tsx`

> Multi-tab settings page covering workspace configuration, environment management, API keys, and user profile.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Settings` | `React.FC` (default) | Settings page component with tabbed navigation |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `isSettingsTabId` | 36-40 | Type guard for valid tab IDs |
| `parseWorkspaceRbacOverride` | 88-96 | Extracts RBAC override matrix from workspace settings |
| `getEffectiveSettingsPermissionMatrix` | 97-114 | Merges default permission matrix with workspace overrides |
| `meetsRole` | 115-137 | Checks if a user's role meets a required role threshold |
| `FeedbackMessage` | 138-159 | Reusable success/error feedback banner component |
| `WorkspaceTab` | 160-646 | Workspace settings: name, GCP project, Pub/Sub, credentials upload, disassociated enterprise recovery, signup links |
| `EnvironmentTab` | 647-1318 | Environment list, create/switch, name/Pub/Sub editing, enterprise binding, upgrade, policy assignment, delete |
| `EnvironmentSignupLink` | 1319-1329 | Environment-scoped signup link settings |
| `SigninEnrollmentConfig` | 1330-1507 | Sign-in URL enrollment configuration panel |
| `ZeroTouchConfig` | 1508-2048 | Zero-touch provisioning panel: iframe token and enrollment token management with personal usage options |
| `ApiKeyScopePanel` | 2049-2284 | API key management panel for a specific scope (workspace or environment) |
| `ApiTab` | 2285-2433 | API keys tab combining workspace and environment key panels |
| `ProfileTab` | 2434-2854 | User profile: name, email, password change, MFA (TOTP) setup/disable |
| `Settings` | 2855 | Main component with tab routing and RBAC-based tab visibility |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useContextStore` | `@/stores/context` | Active workspace, environment, and context operations |
| `useAuthStore` | `@/stores/auth` | Current user info |
| `MIN_PASSWORD_LENGTH`, `MAX_PASSWORD_LENGTH` | `@/constants/auth` | Password validation |
| `useUpdateWorkspace`, `useSetWorkspaceSecrets` | `@/api/queries/workspaces` | Workspace update mutations |
| `useUpdateEnvironment`, `useBindEnvironmentStep1`, `useCreateEnvironment`, `useDeleteEnterprise`, `useDeleteEnvironment`, `useGenerateUpgradeUrl`, `useEnterpriseUpgradeStatus`, `useReconcileEnvironmentDeviceImport` | `@/api/queries/environments` | Environment lifecycle mutations |
| `useCreateApiKey`, `useEnvironmentApiKeys`, `useRevokeApiKey`, `useWorkspaceApiKeys` | `@/api/queries/api-keys` | API key CRUD |
| `PolicyAssignmentSelect` | `@/components/policy/PolicyAssignmentSelect` | Policy assignment dropdown for environments |
| `usePolicyAssignments` | `@/api/queries/policies` | Fetch policy assignments |
| `apiClient` | `@/api/client` | Direct API calls |
| `SignupLinkSettings` | `@/components/settings/SignupLinkSettings` | Signup link configuration component |
| `useGroups` | `@/api/queries/groups` | Group data for sign-in enrollment config |
| `useSigninConfig`, `useUpdateSigninConfig` | `@/api/queries/signin-config` | Sign-in URL enrollment configuration |
| `useZeroTouchOptions`, `useZeroTouchIframeToken`, `useZeroTouchCreateEnrollmentToken` | `@/api/queries/zero-touch` | Zero-touch provisioning configuration |

## Key Logic

The page renders four tabs controlled via URL search params (`?tab=workspace|environment|api|profile`). Tab visibility is RBAC-controlled: the workspace tab requires workspace-level read permission and the environment tab requires environment-level read permission.

**Workspace Tab**: Edit workspace name and default Pub/Sub topic, upload/replace GCP service account credentials (JSON key file), scan for and recover disassociated enterprises (creates a new environment and binds the orphaned enterprise with device import), and manage workspace-scoped signup links.

**Environment Tab**: Lists all environments with bound/unbound status. Supports creating new environments, switching between them, editing environment name and Pub/Sub topic (with workspace default inheritance), binding enterprises via Google sign-up URL flow, enterprise upgrade, reconcile device imports, environment-level policy assignment, environment deletion (with confirmation), sign-in URL enrollment configuration, and zero-touch provisioning configuration (iframe token plus enrollment token selection/creation with personal usage options). The notification types for binding include `ENTERPRISE_UPGRADE`.

**API Tab**: Manages API keys at both workspace and environment scope. Shows existing keys with creation date, scope, and revocation status. Supports creating new keys and revoking existing ones. Newly created keys display the secret once. The role picker in `ApiKeyScopePanel` constrains available roles to those at or below the caller's effective role: `allowedRoleOptions` filters `API_KEY_ROLES` using `ROLE_LEVEL` so that a caller cannot create a key with higher privileges than their own.

**Profile Tab**: Edit first/last name, change password (current + new + confirm), and manage TOTP MFA (setup with QR code, verify, and disable).

All write operations are gated by RBAC permission checks derived from the workspace's effective permission matrix.
