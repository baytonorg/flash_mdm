# `netlify/functions/superadmin-actions.ts`

> Superadmin action dispatcher handling privileged workspace, user, billing, impersonation, migration, and data-purge operations.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `handler` | `(request: Request, context: Context) => Promise<Response>` | Default-exported Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `handleGrantSuperadmin` | 88-114 | Promotes a user to superadmin and logs the action |
| `handleRevokeSuperadmin` | 116-146 | Demotes a superadmin (cannot self-revoke) |
| `handleDeleteUser` | 148-186 | Permanently deletes a user after verifying they have no workspace memberships; nullifies FK references in a transaction |
| `handleRunMigrations` | 188-251 | Invokes the migrate handler internally using MIGRATION_SECRET |
| `handleDisableWorkspace` | 253-269 | Sets `disabled = true` on a workspace |
| `handleEnableWorkspace` | 271-287 | Sets `disabled = false` on a workspace |
| `handleForcePlan` | 289-330 | Upserts a license record to force a workspace onto a specific plan |
| `isStripeMissingResourceError` | 332-338 | Checks if a Stripe error is a "resource_missing" / "no such subscription" error |
| `handleCancelWorkspaceSubscription` | 340-442 | Cancels a Stripe subscription and marks associated license/grants as cancelled in a transaction |
| `handleImpersonate` | 444-526 | Creates an impersonation session for a target user; requires support reason and customer notice acknowledgement |
| `handleStopImpersonation` | 528-609 | Ends an impersonation session and restores the superadmin session (creates a fresh session if the parent plaintext token is unavailable) |
| `handlePurgeData` | 611-664 | Deletes all environments and licenses for a workspace (keeps workspace and members); requires support reason and acknowledgement |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `validateSession`, `requireSuperadmin`, `setSessionCookie`, `clearSessionCookie` | `_lib/auth` | Session validation, superadmin gate, cookie management |
| `queryOne`, `execute`, `transaction` | `_lib/db` | Database queries and transactional writes |
| `generateToken`, `hashToken` | `_lib/crypto` | Creating impersonation session tokens |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers` | HTTP response helpers and request parsing |
| `logAudit` | `_lib/audit` | Audit trail for all actions |
| `getStripe` | `_lib/stripe` | Stripe API client for subscription cancellation |
| `migrateHandler` | `migrate` | Direct invocation of the migration function |

## Key Logic

The handler accepts only POST requests. The request body must contain an `action` string and, for most actions, a `target_id`. A switch dispatches to the appropriate handler function.

**Special case:** `stop_impersonation` uses `validateSession` instead of `requireSuperadmin` because the caller is acting as the impersonated (non-superadmin) user at that point. All other actions require superadmin authentication.

**Impersonation flow:** Creates a new session row with `impersonated_by`, `impersonator_session_id`, `impersonation_mode` (full or read_only), and support metadata. The session cookie is swapped to the impersonation token. Stopping impersonation deletes the impersonation session and either reuses the parent session or mints a fresh superadmin session.

**Subscription cancellation:** Cancels in Stripe first, then updates both `licenses` and `license_grants` tables in a transaction. Handles the case where the subscription is already missing in Stripe gracefully.

**Data purge:** Deletes `environments` (which cascades to devices, policies, etc.) and `licenses` while preserving the workspace and its members.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/.netlify/functions/superadmin-actions` | Superadmin (except `stop_impersonation` which requires any valid session) | Dispatches privileged actions based on `body.action` |
