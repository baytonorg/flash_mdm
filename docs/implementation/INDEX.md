# Implementation Reference Index

> Master lookup for all source files in the flash_mdm codebase. Each entry links to a detailed per-file reference doc with exports, dependencies, and key logic.

For deeper information on architecture, deployment, security, operations, and development workflows, see the [docs README](../README.md) which indexes the full documentation suite.

## Quick Reference

| Task | See |
|------|-----|
| Modify auth flow | [auth.md](backend/lib/auth.md), [auth-login.md](backend/handlers/auth-login.md), [auth store](frontend/stores/auth.md) |
| Add a new CRUD endpoint | [helpers.md](backend/lib/helpers.md), [db.md](backend/lib/db.md), [rbac.md](backend/lib/rbac.md) |
| Change policy generation | [policy-generation.md](backend/lib/policy-generation.md), [policy-merge.md](backend/lib/policy-merge.md), [policy-derivatives.md](backend/lib/policy-derivatives.md) |
| Add a device command | [device-commands.md](backend/lib/device-commands.md), [amapi-command.md](backend/lib/amapi-command.md), [device-command.md](backend/handlers/device-command.md), [CommandModal.md](frontend/components/device/CommandModal.md) |
| Modify RBAC permissions | [rbac.md](backend/lib/rbac.md), [rbac-matrix.md](backend/lib/rbac-matrix.md), [roles-rbac.md](backend/handlers/roles-rbac.md) |
| Add a new API client hook | [client.md](frontend/api/client.md), [devices.md](frontend/api/devices.md) (example pattern) |
| Update licensing logic | [licensing.md](backend/lib/licensing.md), [licensing-reconcile.md](backend/lib/licensing-reconcile.md), [stripe.md](backend/lib/stripe.md) |
| Add a workflow action | [workflow-dispatch.md](backend/lib/workflow-dispatch.md), [workflow-evaluate-background.md](backend/handlers/workflow-evaluate-background.md), [ActionSelector.md](frontend/components/workflows/ActionSelector.md) |
| Modify enrollment flow | [enrollment-create.md](backend/handlers/enrollment-create.md), [signin-enroll.md](backend/handlers/signin-enroll.md), [TokenCreator.md](frontend/components/enrollment/TokenCreator.md) |
| Add a dashboard widget | [dashboard-data.md](backend/handlers/dashboard-data.md), [WidgetGrid.md](frontend/components/dashboard/WidgetGrid.md), [dashboard.md](frontend/api/dashboard.md) |
| Configure geofencing | [haversine.md](backend/lib/haversine.md), [geofence-crud.md](backend/handlers/geofence-crud.md), [GeofenceEditor.md](frontend/components/geofencing/GeofenceEditor.md) |
| Update email templates | [resend.md](backend/lib/resend.md), [html.md](backend/lib/html.md), [brand.md](backend/lib/brand.md) |
| Work on Flashi assistant | [flashagent-runtime.md](backend/lib/flashagent-runtime.md), [flashagent-chat.md](backend/handlers/flashagent-chat.md), [FlashiPanel.md](frontend/components/flashi/FlashiPanel.md) |
| Configure MCP proxy | [mcp-proxy.md](backend/lib/mcp-proxy.md), [mcp-amapi.md](backend/handlers/mcp-amapi.md), [workspace-credentials.md](backend/lib/workspace-credentials.md), [enterprise-utils.md](backend/lib/enterprise-utils.md) |
| Configure zero-touch | [environment-zero-touch.md](backend/handlers/environment-zero-touch.md), [zero-touch.md](frontend/api/zero-touch.md), [Settings.md](frontend/pages/Settings.md) |
| Work on app feedback | [app-feedback.md](backend/handlers/app-feedback.md), [app-feedback.md](frontend/api/app-feedback.md), [DeviceDetail.md](frontend/pages/DeviceDetail.md) |

---

## Backend -- Library (`netlify/functions/_lib/`)

| File | Purpose |
|------|---------|
| [amapi.md](backend/lib/amapi.md) | Core HTTP client for authenticated requests to the Google Android Management API |
| [amapi-application-policy.md](backend/lib/amapi-application-policy.md) | Validates individual AMAPI application policy fragments and provides install type constants/guards |
| [amapi-command.md](backend/lib/amapi-command.md) | Builds and validates AMAPI device command payloads for all supported command types |
| [amapi-policy-validation.md](backend/lib/amapi-policy-validation.md) | Comprehensive preflight validation of AMAPI policy payloads against known API constraints |
| [app-metadata-cache.md](backend/lib/app-metadata-cache.md) | Utilities for determining when app metadata needs hydration and merging hydrated data |
| [audit.md](backend/lib/audit.md) | Writes sanitized audit log entries with automatic API key attribution and field redaction |
| [auth.md](backend/lib/auth.md) | Session and API key authentication with CSRF protection, impersonation, and sliding expiration |
| [billing-notifications.md](backend/lib/billing-notifications.md) | Builds billing email content and sends deduplicated billing notifications to workspace admins |
| [blobs.md](backend/lib/blobs.md) | Thin wrapper around Netlify Blobs providing typed get/set/delete operations |
| [brand.md](backend/lib/brand.md) | Centralized brand/product name constants used across the backend |
| [crypto.md](backend/lib/crypto.md) | AES-256-GCM authenticated encryption/decryption and SHA-256 token hashing utilities |
| [db.md](backend/lib/db.md) | PostgreSQL connection pool and query helpers (`query`, `queryOne`, `execute`, `transaction`) |
| [db-errors.md](backend/lib/db-errors.md) | Postgres error code detection utility for identifying missing table/relation errors |
| [deployment-sync.md](backend/lib/deployment-sync.md) | Synchronizes policy derivatives to AMAPI after deployment configuration changes |
| [device-apps.md](backend/lib/device-apps.md) | Extracts and normalizes device application inventory from an AMAPI device snapshot |
| [device-commands.md](backend/lib/device-commands.md) | Shared command catalogs, alias normalization, and enum guards for device command handling |
| [device-command-permissions.md](backend/lib/device-command-permissions.md) | Maps device commands to permission actions, distinguishing standard from destructive commands |
| [google-auth.md](backend/lib/google-auth.md) | Google OAuth2 token minting for AMAPI access and OAuth URL generation for consent flow |
| [haversine.md](backend/lib/haversine.md) | Haversine distance calculation, circular geofence check, and polygon point-in-polygon test |
| [helpers.md](backend/lib/helpers.md) | Common HTTP request/response utilities: JSON responses, CSRF, UUID validation, body parsing |
| [html.md](backend/lib/html.md) | HTML entity escaping utility to prevent XSS in server-rendered output |
| [internal-auth.md](backend/lib/internal-auth.md) | Authenticates internal/scheduled function calls using a shared secret |
| [licensing.md](backend/lib/licensing.md) | Core licensing engine: seat entitlements, licensing snapshots, enrollment block enforcement |
| [licensing-reconcile.md](backend/lib/licensing-reconcile.md) | Background reconciliation scanning environments for licence overage and enforcement actions |
| [password-policy.md](backend/lib/password-policy.md) | Password length constraints used for validation across the application |
| [platform-settings.md](backend/lib/platform-settings.md) | Reads and writes global platform settings from the `platform_settings` singleton row |
| [policy-derivatives.md](backend/lib/policy-derivatives.md) | Manages per-scope AMAPI policy derivatives with variable resolution and AMAPI patch orchestration |
| [policy-generation.md](backend/lib/policy-generation.md) | Generates final AMAPI policy payload by merging base config with scoped deployments and overrides |
| [policy-locks.md](backend/lib/policy-locks.md) | Manages hierarchical policy lock state and RBAC checks for lock/override modifications |
| [policy-merge.md](backend/lib/policy-merge.md) | Shared helpers for merging ONC (Wi-Fi) and APN network deployments into policy config |
| [policy-recompile.md](backend/lib/policy-recompile.md) | Recompiles a policy from assigned component fragments with versioned snapshot and AMAPI sync |
| [policy-update-mask.md](backend/lib/policy-update-mask.md) | Computes an AMAPI-compatible update mask of differing top-level keys between two configs |
| [postgres-connection.md](backend/lib/postgres-connection.md) | Normalizes Postgres connection strings by upgrading weak SSL modes to `verify-full` |
| [rate-limiter.md](backend/lib/rate-limiter.md) | Postgres-backed token bucket rate limiter for global and per-resource AMAPI rate limits |
| [rbac.md](backend/lib/rbac.md) | Role-based access control engine with hierarchical role checks across workspaces, environments, and groups |
| [rbac-matrix.md](backend/lib/rbac-matrix.md) | Utilities for reading, validating, merging, and persisting workspace-level RBAC permission overrides |
| [request-auth-context.md](backend/lib/request-auth-context.md) | AsyncLocalStorage-based per-request audit authentication context for ambient identity access |
| [resend.md](backend/lib/resend.md) | Email sending via Resend API with HTML templates for magic links, verification codes, and invites |
| [stripe.md](backend/lib/stripe.md) | Platform-level Stripe client for checkout sessions, billing portal sessions, and webhook verification |
| [totp.md](backend/lib/totp.md) | TOTP verification and backup code consumption for two-factor authentication |
| [variable-resolution.md](backend/lib/variable-resolution.md) | Resolves strict `${namespace.key}` placeholders in policy JSON to device/user/group/environment values |
| [webhook-ssrf.md](backend/lib/webhook-ssrf.md) | SSRF protection for outbound webhook URLs with hostname validation and blocked IP detection |
| [workflow-dispatch.md](backend/lib/workflow-dispatch.md) | Dispatches workflow evaluation jobs into the job queue when device events occur |
| [workspace-stripe.md](backend/lib/workspace-stripe.md) | Retrieves and decrypts workspace-level Stripe credentials for self-managed billing |
| [enterprise-utils.md](backend/lib/enterprise-utils.md) | Shared enterprise resource name extraction for AMAPI scope validation |
| [flashagent-billing.md](backend/lib/flashagent-billing.md) | Soft billing entitlement hook for the Flashi assistant (permissive stub for future paid addon) |
| [flashagent-prompt.md](backend/lib/flashagent-prompt.md) | System prompt builder with structured JSON context and prompt injection defences |
| [flashagent-runtime.md](backend/lib/flashagent-runtime.md) | Core tool-calling runtime: OpenAI loop with AMAPI MCP and Flash internal tools |
| [flashagent-settings.md](backend/lib/flashagent-settings.md) | Resolves effective assistant settings (platform + workspace + environment toggles, role hierarchy, API key lifecycle) |
| [mcp-proxy.md](backend/lib/mcp-proxy.md) | Shared MCP proxy utilities: JSON-RPC validation, upstream proxy, rate limiting |
| [workspace-credentials.md](backend/lib/workspace-credentials.md) | Shared workspace credential resolution: decrypts Google SA and mints access tokens |

---

## Backend -- Handlers (`netlify/functions/`)

### Authentication

| File | Purpose |
|------|---------|
| [auth-config.md](backend/handlers/auth-config.md) | Returns public authentication configuration settings (e.g. invite-only mode) |
| [auth-login.md](backend/handlers/auth-login.md) | Authenticates user with email/password, optional TOTP/backup-code MFA, issues session cookie |
| [auth-logout.md](backend/handlers/auth-logout.md) | Destroys the current session and clears the session cookie |
| [auth-magic-link-start.md](backend/handlers/auth-magic-link-start.md) | Initiates a magic-link login flow by generating a token and emailing the link |
| [auth-magic-link-verify.md](backend/handlers/auth-magic-link-verify.md) | Verifies a magic-link token, creating a session or redirecting to MFA |
| [auth-magic-link-complete.md](backend/handlers/auth-magic-link-complete.md) | Completes a magic-link login/reset flow requiring TOTP MFA verification |
| [auth-password-change.md](backend/handlers/auth-password-change.md) | Allows an authenticated user to change their password |
| [auth-password-reset-start.md](backend/handlers/auth-password-reset-start.md) | Initiates a password-reset flow by generating a token and emailing a reset link |
| [auth-password-reset-complete.md](backend/handlers/auth-password-reset-complete.md) | Completes password-reset by consuming the reset token and setting a new password |
| [auth-register.md](backend/handlers/auth-register.md) | Registers a new user with support for bootstrap, self-signup, invite, and signup-link flows |
| [auth-session.md](backend/handlers/auth-session.md) | Returns current user's session info, or clears environment-setup flag via POST |
| [auth-totp-setup.md](backend/handlers/auth-totp-setup.md) | Initiates TOTP 2FA setup by generating secret, backup codes, and otpauth URI |
| [auth-totp-verify.md](backend/handlers/auth-totp-verify.md) | Handles TOTP verification (finalising setup) and TOTP disabling |
| [api-key-crud.md](backend/handlers/api-key-crud.md) | CRUD operations for API keys scoped to workspaces or environments with RBAC |
| [signin-config.md](backend/handlers/signin-config.md) | Manages sign-in enrollment config for an environment with AMAPI `signinDetails` sync |
| [signin-enroll.md](backend/handlers/signin-enroll.md) | Public sign-in enrollment endpoint verifying email via 6-digit code, creating AMAPI token |
| [signup-link-crud.md](backend/handlers/signup-link-crud.md) | Full CRUD for signup links with slug validation, domain restrictions, and role defaults |
| [signup-link-resolve.md](backend/handlers/signup-link-resolve.md) | Public endpoint resolving a signup link by slug or token for the signup page |

### Workspace and Environment

| File | Purpose |
|------|---------|
| [workspace-crud.md](backend/handlers/workspace-crud.md) | CRUD for workspaces: list, get, create, update, store GCP credentials, discover orphaned enterprises |
| [workspace-invite.md](backend/handlers/workspace-invite.md) | Full invitation lifecycle: create/send, validate tokens, accept invites for workspace membership |
| [workspace-users.md](backend/handlers/workspace-users.md) | Manages workspace membership: list users, change roles, update access scope, bulk ops, remove users |
| [workspace-billing.md](backend/handlers/workspace-billing.md) | Workspace billing: Stripe integration, pricing catalog, billing state, checkout sessions, portal |
| [workspace-billing-webhook.md](backend/handlers/workspace-billing-webhook.md) | Stripe webhook receiver for workspace billing -- provisions entitlements on checkout/payment events |
| [environment-crud.md](backend/handlers/environment-crud.md) | CRUD for environments with scoped visibility, default policy creation, AMAPI enterprise sync |
| [environment-bind.md](backend/handlers/environment-bind.md) | Android Enterprise binding lifecycle: signup URL flow, attach orphaned, unbind, delete |
| [environment-enterprise.md](backend/handlers/environment-enterprise.md) | Enterprise actions: upgrade eligibility check, Workspace upgrade URL, device re-import |
| [environment-renew.md](backend/handlers/environment-renew.md) | Renews an environment's Android Enterprise signup URL |
| [roles-rbac.md](backend/handlers/roles-rbac.md) | RBAC permission matrix: view effective permissions, update custom overrides, reset to defaults |

### Devices and Groups

| File | Purpose |
|------|---------|
| [device-list.md](backend/handlers/device-list.md) | Lists devices with pagination, search, filtering, sorting, and group-scoped RBAC |
| [device-get.md](backend/handlers/device-get.md) | Full device details with apps, locations, audit log, policy resolution; supports delete/rename/reassign |
| [device-command.md](backend/handlers/device-command.md) | Issues a single device management command (lock, wipe, reboot, etc.) via AMAPI |
| [device-bulk.md](backend/handlers/device-bulk.md) | Queues bulk device commands for up to 500 devices via the background job queue |
| [device-operations.md](backend/handlers/device-operations.md) | Lists, retrieves, and cancels AMAPI device operations with pagination and deduplication |
| [group-crud.md](backend/handlers/group-crud.md) | Full CRUD and bulk operations for device groups with hierarchical closure table maintenance |

### Policies and Components

| File | Purpose |
|------|---------|
| [policy-crud.md](backend/handlers/policy-crud.md) | Core CRUD for policies: list, get, create, update, delete, bulk ops, AMAPI fetch, derivatives |
| [policy-assign.md](backend/handlers/policy-assign.md) | Policy assignment/unassignment, listing assignments, resolving effective policy via scope cascade |
| [policy-clone.md](backend/handlers/policy-clone.md) | Clones a policy into a new draft, copying config, metadata, components, and version record |
| [policy-overrides.md](backend/handlers/policy-overrides.md) | Manages policy overrides at group/device scope with inherited lock state and validation |
| [policy-versions.md](backend/handlers/policy-versions.md) | Read-only handler for listing policy version history and retrieving version config snapshots |
| [component-crud.md](backend/handlers/component-crud.md) | CRUD for policy components with automatic recompilation of affected policies on change |
| [component-assign.md](backend/handlers/component-assign.md) | Manages component-to-policy assignment/unassignment with policy recompilation triggers |
| [certificate-crud.md](backend/handlers/certificate-crud.md) | Certificate management: list, upload (PEM parsing, blob storage), soft-delete with derivative sync |
| [deployment-jobs.md](backend/handlers/deployment-jobs.md) | Manages deployment jobs: queue, list, cancel, rollback with batch AMAPI sync |
| [deployment-jobs-background.md](backend/handlers/deployment-jobs-background.md) | Background function processing a deployment job asynchronously via batch AMAPI sync |

### Applications and Networks

| File | Purpose |
|------|---------|
| [app-crud.md](backend/handlers/app-crud.md) | Multi-route handler for app catalog management, scope config, and legacy deployment CRUD |
| [app-deploy.md](backend/handlers/app-deploy.md) | Deploys an app to a scope (environment/group/device) with catalog upsert and AMAPI policy sync |
| [app-details.md](backend/handlers/app-details.md) | Fetches detailed application metadata from Google AMAPI for a package name |
| [app-list.md](backend/handlers/app-list.md) | Lists legacy app deployments with resolved scope names and parsed managed configs |
| [app-search.md](backend/handlers/app-search.md) | Searches apps via AMAPI exact package lookup or signals Play iframe web token needed |
| [app-web-token.md](backend/handlers/app-web-token.md) | Creates a managed Google Play web token for embedding the Play Store iframe |
| [network-crud.md](backend/handlers/network-crud.md) | CRUD for network deployments (WiFi/APN) with policy cleanup on delete and derivative sync |
| [network-deploy.md](backend/handlers/network-deploy.md) | Deploys WiFi or APN network config to a scope, normalizing ONC/APN and syncing AMAPI policies |
| [network-list.md](backend/handlers/network-list.md) | Lists all network deployments (WiFi/APN) with normalized profiles and inferred types |

### Enrollment, Workflows, and Geofencing

| File | Purpose |
|------|---------|
| [enrollment-create.md](backend/handlers/enrollment-create.md) | Creates an AMAPI enrollment token with optional group scope and provisioning extras |
| [enrollment-crud.md](backend/handlers/enrollment-crud.md) | Get, delete, and bulk-delete for enrollment tokens with best-effort AMAPI deletion |
| [enrollment-list.md](backend/handlers/enrollment-list.md) | Lists enrollment tokens with group and policy metadata, optional expired token inclusion |
| [enrollment-sync.md](backend/handlers/enrollment-sync.md) | Synchronizes local enrollment tokens with AMAPI, importing new and invalidating stale |
| [workflow-crud.md](backend/handlers/workflow-crud.md) | Full CRUD for workflows: list, get, create, update, delete, toggle, test (dry-run), bulk ops |
| [workflow-cron-scheduled.md](backend/handlers/workflow-cron-scheduled.md) | Scheduled function (every 5 min) evaluating scheduled-trigger workflows against in-scope devices |
| [workflow-evaluate-background.md](backend/handlers/workflow-evaluate-background.md) | Background function evaluating a workflow against a device, checking conditions, executing actions |
| [geofence-crud.md](backend/handlers/geofence-crud.md) | Full CRUD for geofences with device-inside counts, per-device state, and enable/disable toggle |
| [geofence-check-scheduled.md](backend/handlers/geofence-check-scheduled.md) | Scheduled function (every 10 min) evaluating geofences against device locations for state changes |

### Licensing and Stripe

| File | Purpose |
|------|---------|
| [license-assign.md](backend/handlers/license-assign.md) | Assigns or unassigns a licence from a device within a licensing-enabled workspace |
| [license-grants.md](backend/handlers/license-grants.md) | Lists licence grants and invoices; allows users to submit invoice-based purchase requests |
| [license-plans.md](backend/handlers/license-plans.md) | CRUD for licence plans with Stripe price enrichment (create/update/delete restricted to superadmin) |
| [license-settings.md](backend/handlers/license-settings.md) | Reads and updates per-workspace licensing settings (free tier, billing method, grace period) |
| [license-status.md](backend/handlers/license-status.md) | Comprehensive licensing status snapshot: plan details, device counts, entitlements, breakdowns |
| [licensing-reconcile.md](backend/handlers/licensing-reconcile.md) | Manually triggers the licensing reconciliation process (internal callers only) |
| [licensing-reconcile-scheduled.md](backend/handlers/licensing-reconcile-scheduled.md) | Scheduled function running licensing reconciliation hourly |
| [stripe-checkout.md](backend/handlers/stripe-checkout.md) | Creates a Stripe Checkout session for licence plan purchase with gift-seat offset logic |
| [stripe-portal.md](backend/handlers/stripe-portal.md) | Creates a Stripe Customer Portal session for subscription management |
| [stripe-webhook.md](backend/handlers/stripe-webhook.md) | Handles Stripe webhook events to synchronize subscription state and process payments |

### AI Assistant (Flashi) and MCP

| File | Purpose |
|------|---------|
| [flashagent-chat.md](backend/handlers/flashagent-chat.md) | Main Flashi chat endpoint: receives user message, runs OpenAI tool-calling loop, returns reply |
| [flashagent-chat-history.md](backend/handlers/flashagent-chat-history.md) | Per-user chat history: load, append, export (markdown), and clear messages |
| [flashagent-download.md](backend/handlers/flashagent-download.md) | Secure download endpoint for CSV files generated by Flashi during chat |
| [flashagent-settings.md](backend/handlers/flashagent-settings.md) | Reads/updates effective assistant enabled state and role (platform + workspace + environment) |
| [flashagent-workspace-settings.md](backend/handlers/flashagent-workspace-settings.md) | Reads/updates workspace-level assistant config: enabled, role boundaries, OpenAI overrides |
| [mcp-amapi.md](backend/handlers/mcp-amapi.md) | AMAPI MCP proxy: proxies read-only JSON-RPC to Google's AMAPI MCP endpoint |

### App Feedback and Zero-Touch

| File | Purpose |
|------|---------|
| [app-feedback.md](backend/handlers/app-feedback.md) | App feedback item retrieval from keyed app states synced via status reports |
| [environment-zero-touch.md](backend/handlers/environment-zero-touch.md) | Zero-touch provisioning: iframe tokens and reusable enrollment token creation |

### Superadmin and Infrastructure

| File | Purpose |
|------|---------|
| [superadmin-actions.md](backend/handlers/superadmin-actions.md) | Superadmin action dispatcher: workspace, user, billing, impersonation, migration, data-purge ops |
| [superadmin-billing.md](backend/handlers/superadmin-billing.md) | Superadmin billing: list/filter invoices, mark paid with grant creation, create manual/gift grants |
| [superadmin-settings.md](backend/handlers/superadmin-settings.md) | Superadmin platform-wide settings: invite-only registration, licensing toggles, default free tier |
| [superadmin-stats.md](backend/handlers/superadmin-stats.md) | Superadmin dashboard stats: platform counts, device distribution, recent signups, event logs |
| [superadmin-users.md](backend/handlers/superadmin-users.md) | Superadmin user listing with search, pagination, and nested workspace membership details |
| [superadmin-workspaces.md](backend/handlers/superadmin-workspaces.md) | Superadmin workspace listing/detail with environments, users, license info, support history |
| [audit-log.md](backend/handlers/audit-log.md) | Paginated audit log viewer with filtering by scope, actor, action, resource, user, and date |
| [dashboard-data.md](backend/handlers/dashboard-data.md) | Environment dashboard data: device stats, compliance rates, distributions, trends, events |
| [report-download.md](backend/handlers/report-download.md) | Serves exported report files (CSV/JSON) from blob storage as downloadable attachments |
| [report-export.md](backend/handlers/report-export.md) | Generates and stores data exports (devices, policies, audit logs, apps) in CSV or JSON |
| [pubsub-webhook.md](backend/handlers/pubsub-webhook.md) | Google Cloud Pub/Sub push handler receiving device events and enqueuing background jobs |
| [sync-process-background.md](backend/handlers/sync-process-background.md) | Background job processor for PubSub events and bulk device commands via AMAPI |
| [sync-reconcile-scheduled.md](backend/handlers/sync-reconcile-scheduled.md) | Scheduled reconciliation (every 15 min) syncing local device/token records against AMAPI |
| [cleanup-scheduled.md](backend/handlers/cleanup-scheduled.md) | Daily cleanup purging expired sessions, magic links, invites, old audit logs, stale jobs |
| [migrate.md](backend/handlers/migrate.md) | Smart database migration runner applying pending SQL migrations idempotently via `_migrations` table |

---

## Frontend -- API Layer (`src/api/`)

| File | Purpose |
|------|---------|
| [client.md](frontend/api/client.md) | Singleton HTTP client wrapping `fetch` with JSON serialization, credentials, and 401 redirect |
| [api-keys.md](frontend/api/api-keys.md) | React Query hooks for listing, creating, and revoking API keys |
| [apps.md](frontend/api/apps.md) | React Query hooks for searching, deploying, and managing Android apps |
| [audit.md](frontend/api/audit.md) | React Query hook for fetching paginated audit log entries with 5-second polling |
| [components.md](frontend/api/components.md) | React Query hooks for managing reusable policy components |
| [dashboard.md](frontend/api/dashboard.md) | React Query hook for fetching dashboard statistics |
| [deployments.md](frontend/api/deployments.md) | React Query hooks for creating, monitoring, cancelling, and rolling back deployment jobs |
| [device-operations.md](frontend/api/device-operations.md) | React Query hooks for listing and cancelling AMAPI device operations |
| [devices.md](frontend/api/devices.md) | React Query hooks for listing, viewing, commanding, deleting, and bulk actions on devices |
| [enrollment.md](frontend/api/enrollment.md) | React Query hooks for enrollment token management: list, create, sync, delete, bulk ops |
| [environments.md](frontend/api/environments.md) | React Query hooks for environment CRUD, enterprise binding, upgrade, and device import |
| [geofences.md](frontend/api/geofences.md) | React Query hooks for geofence CRUD with circle/polygon boundaries and enter/exit actions |
| [groups.md](frontend/api/groups.md) | React Query hooks for hierarchical device group management with CRUD and bulk ops |
| [licenses.md](frontend/api/licenses.md) | React Query hooks for license status, Stripe checkout sessions, and device license assignment |
| [networks.md](frontend/api/networks.md) | React Query hooks for Wi-Fi and APN network configuration management with AMAPI sync |
| [policies.md](frontend/api/policies.md) | React Query hooks for policy CRUD, AMAPI fetch, scope assignments, locks, and bulk ops |
| [policy-overrides.md](frontend/api/policy-overrides.md) | React Query hooks for per-scope policy overrides and inherited lock state queries |
| [rbac.md](frontend/api/rbac.md) | React Query hooks for reading/updating the workspace RBAC permission matrix |
| [signin-config.md](frontend/api/signin-config.md) | React Query hooks for Google Sign-In enrollment configuration |
| [signupLinks.md](frontend/api/signupLinks.md) | React Query hooks for signup link CRUD and resolution |
| [users.md](frontend/api/users.md) | React Query hooks for workspace user management: list, invite, update, remove, bulk ops |
| [workflows.md](frontend/api/workflows.md) | React Query hooks for workflow CRUD, toggle, bulk operations, and test execution |
| [workspaces.md](frontend/api/workspaces.md) | React Query hooks for workspace CRUD and Google service account credential management |
| [flashagent.md](frontend/api/flashagent.md) | React Query hooks for Flashi assistant settings (environment and workspace level) |
| [app-feedback.md](frontend/api/app-feedback.md) | React Query hooks for listing app feedback items with environment/device filters |
| [zero-touch.md](frontend/api/zero-touch.md) | React Query hooks for zero-touch provisioning options, iframe tokens, and enrollment token creation |

---

## Frontend -- Stores, Hooks, Utilities

### Stores

| File | Purpose |
|------|---------|
| [auth.md](frontend/stores/auth.md) | Zustand store managing user authentication state, login/logout flows, and session lifecycle |
| [context.md](frontend/stores/context.md) | Zustand store managing active workspace/environment/group selection with localStorage persistence |
| [ui.md](frontend/stores/ui.md) | Zustand store for global UI preferences: sidebar visibility and list view mode |
| [flashagent.md](frontend/stores/flashagent.md) | Zustand store for Flashi assistant chat panel open/close state |

### Hooks

| File | Purpose |
|------|---------|
| [useBulkSelection.md](frontend/hooks/useBulkSelection.md) | React hook for bulk row selection with explicit ID lists and "select all matching" with exclusions |
| [useEnvironmentGuard.md](frontend/hooks/useEnvironmentGuard.md) | React hook that redirects when the active environment no longer matches the record's environment |
| [useFlashiChat.md](frontend/hooks/useFlashiChat.md) | Main hook managing Flashi chat state, history persistence, message sending, and progress |

### Utilities and Libraries

| File | Purpose |
|------|---------|
| [brand.md](frontend/lib/brand.md) | Centralized brand/product name constants for consistent naming across the frontend |
| [haversine.md](frontend/lib/haversine.md) | Geospatial utilities: Haversine distance, circular geofence check, polygon point-in-polygon |
| [redirect.md](frontend/lib/redirect.md) | Safe in-app redirect utilities preventing open-redirect vulnerabilities |
| [device-state.md](frontend/lib/device-state.md) | Device display state resolution from AMAPI snapshot `appliedState` |
| [currency.md](frontend/utils/currency.md) | Converts major-unit currency input strings to minor units (cents) |
| [format.md](frontend/utils/format.md) | Date formatting utility for displaying ISO timestamps in localized short format |
| [flashiProgress.md](frontend/utils/flashiProgress.md) | Contextual loading step generation for the Flashi chat UI |

### Constants

| File | Purpose |
|------|---------|
| [auth.md](frontend/constants/auth.md) | Password length constraint constants for auth form validation |
| [billing.md](frontend/constants/billing.md) | Billing duration options and normalization for subscription/license duration fields |

### Types

| File | Purpose |
|------|---------|
| [licensing.md](frontend/types/licensing.md) | TypeScript interface for the workspace license settings API response |

---

## Frontend -- Components

### Flashi (AI Assistant)

| File | Purpose |
|------|---------|
| [FlashiButton.md](frontend/components/flashi/FlashiButton.md) | Fixed-position FAB that toggles the Flashi chat panel |
| [FlashiPanel.md](frontend/components/flashi/FlashiPanel.md) | Floating chat panel with header controls, message list, and input |
| [FlashiMessageList.md](frontend/components/flashi/FlashiMessageList.md) | Message rendering with XSS-safe markdown, DOMPurify, and role-based styling |
| [FlashiInput.md](frontend/components/flashi/FlashiInput.md) | Auto-growing textarea with send button and feature gate disabled state |

### Common

| File | Purpose |
|------|---------|
| [BulkActionBar.md](frontend/components/common/BulkActionBar.md) | Fixed bottom bar displaying contextual bulk actions when rows are selected |
| [CardGrid.md](frontend/components/common/CardGrid.md) | Generic responsive grid layout rendering items as cards with loading/empty states |
| [ConfirmModal.md](frontend/components/common/ConfirmModal.md) | Modal dialog for confirming destructive or important actions with danger/default variants |
| [ContextSwitcher.md](frontend/components/common/ContextSwitcher.md) | Sidebar component for switching active workspace, environment, and group context |
| [DataTable.md](frontend/components/common/DataTable.md) | Generic data table with column sorting, row selection, click handling, loading/empty states |
| [EmptyState.md](frontend/components/common/EmptyState.md) | Centered placeholder UI for empty lists/views with optional icon and action button |
| [ErrorBoundary.md](frontend/components/common/ErrorBoundary.md) | React error boundary catching render errors with recovery UI and dynamic import handling |
| [FilterBar.md](frontend/components/common/FilterBar.md) | Composable toolbar with search input, optional filter dropdowns, and leading accessory slot |
| [GlobalSearch.md](frontend/components/common/GlobalSearch.md) | Full-screen modal search querying devices, policies, groups, users with debounced input |
| [LivePageIndicator.md](frontend/components/common/LivePageIndicator.md) | Pulsing icon indicator showing that a page auto-refreshes on an interval |
| [NotFound.md](frontend/components/common/NotFound.md) | Full-page 404 component for unmatched routes |
| [PageLoadingState.md](frontend/components/common/PageLoadingState.md) | Centered spinner with label for full-page or section loading |
| [Pagination.md](frontend/components/common/Pagination.md) | Pagination controls with page buttons, prev/next nav, per-page selector, and item range |
| [SelectAllMatchingNotice.md](frontend/components/common/SelectAllMatchingNotice.md) | Banner offering to extend selection to all matching rows across pages |
| [StatusBadge.md](frontend/components/common/StatusBadge.md) | Colored pill badge auto-mapping status strings to semantic color variants |
| [TableLoadingState.md](frontend/components/common/TableLoadingState.md) | Skeleton loading placeholder mimicking a data table with animated pulse rows |
| [ViewToggle.md](frontend/components/common/ViewToggle.md) | Toggle button group for switching between table and card view modes |

### Policy

| File | Purpose |
|------|---------|
| [BooleanField.md](frontend/components/policy/BooleanField.md) | Toggle switch field for boolean policy settings |
| [ComponentPicker.md](frontend/components/policy/ComponentPicker.md) | Dual-pane picker for assigning/unassigning policy components with config preview |
| [EnumField.md](frontend/components/policy/EnumField.md) | Enum selector rendering as radio cards (<=5 options) or dropdown (>5) |
| [JsonField.md](frontend/components/policy/JsonField.md) | Textarea-based JSON editor with live parsing, kind validation, and external sync |
| [LockControls.md](frontend/components/policy/LockControls.md) | UI for locking policy or individual AMAPI sections to prevent child-scope overrides |
| [NumberField.md](frontend/components/policy/NumberField.md) | Numeric input field with optional min/max range display |
| [PolicyAssignmentSelect.md](frontend/components/policy/PolicyAssignmentSelect.md) | Dropdown for assigning/unassigning a policy at a given scope |
| [PolicyCategoryNav.md](frontend/components/policy/PolicyCategoryNav.md) | Sidebar navigation listing policy config categories filtered by management scenario |
| [PolicyDerivativesPanel.md](frontend/components/policy/PolicyDerivativesPanel.md) | Panel displaying policy derivatives, bulk group assignment, and deployment status |
| [PolicyFormSection.md](frontend/components/policy/PolicyFormSection.md) | Mega-component rendering category-specific policy config forms for all AMAPI sections |
| [PolicyJsonEditor.md](frontend/components/policy/PolicyJsonEditor.md) | Monaco-based JSON editor for raw policy configuration editing |
| [PolicyOverrideEditor.md](frontend/components/policy/PolicyOverrideEditor.md) | Editor for scoped policy overrides at group/device level with lock management |
| [RepeaterField.md](frontend/components/policy/RepeaterField.md) | Dynamic list field for adding, removing, and editing repeated items |
| [SelectField.md](frontend/components/policy/SelectField.md) | Dropdown select field with custom chevron icon |
| [TextField.md](frontend/components/policy/TextField.md) | Text input field supporting single-line and multiline modes |

### Device

| File | Purpose |
|------|---------|
| [CommandModal.md](frontend/components/device/CommandModal.md) | Modal for sending AMAPI device commands (single or bulk) with command-specific inputs |
| [DeviceAppInventory.md](frontend/components/device/DeviceAppInventory.md) | Searchable table of installed applications with icon, package, version, and state |
| [DeviceAuditLog.md](frontend/components/device/DeviceAuditLog.md) | Timeline-style audit log entries for a device with actions, timestamps, and JSON details |
| [DeviceInfo.md](frontend/components/device/DeviceInfo.md) | Comprehensive device info view: hardware, software, network, security, management, and charts |
| [DeviceLocationHistory.md](frontend/components/device/DeviceLocationHistory.md) | Table of device location history records with coordinates, accuracy, and timestamps |
| [DeviceOperations.md](frontend/components/device/DeviceOperations.md) | AMAPI long-running operations list with status indicators and cancel capability |
| [DeviceOverview.md](frontend/components/device/DeviceOverview.md) | Overview dashboard: identity, status, activity timeline, enrolment details, and app summary |
| [DeviceRawSnapshot.md](frontend/components/device/DeviceRawSnapshot.md) | Interactive JSON tree viewer for raw AMAPI device snapshot with copy-to-clipboard |

### Apps

| File | Purpose |
|------|---------|
| [AmapiApplicationPolicyEditor.md](frontend/components/apps/AmapiApplicationPolicyEditor.md) | Form/JSON editor for AMAPI `applications[]` policy fields including permissions and config |
| [AppScopeSelector.md](frontend/components/apps/AppScopeSelector.md) | Radio-button selector for app deployment scope: environment, group, or device |
| [ManagedConfigEditor.md](frontend/components/apps/ManagedConfigEditor.md) | Dynamic form editor rendering managed config fields based on app `ManagedProperty` schema |
| [PlayStoreIframe.md](frontend/components/apps/PlayStoreIframe.md) | Embeds managed Google Play iframe using `gapi.iframes` with app selection/approval events |

### Dashboard

| File | Purpose |
|------|---------|
| [ComplianceWidget.md](frontend/components/dashboard/ComplianceWidget.md) | Doughnut chart showing fleet compliance rate with color-coded thresholds |
| [DeviceStateWidget.md](frontend/components/dashboard/DeviceStateWidget.md) | Horizontal bar chart of device counts by management state |
| [EnrollmentTrendsWidget.md](frontend/components/dashboard/EnrollmentTrendsWidget.md) | Area line chart showing enrolment trends over the last 30 days |
| [OemBreakdownWidget.md](frontend/components/dashboard/OemBreakdownWidget.md) | Doughnut chart showing device distribution by manufacturer |
| [OsVersionWidget.md](frontend/components/dashboard/OsVersionWidget.md) | Horizontal bar chart of device distribution by Android OS version |
| [RecentEventsWidget.md](frontend/components/dashboard/RecentEventsWidget.md) | Scrollable list of up to 10 recent audit events with relative timestamps |
| [StatCard.md](frontend/components/dashboard/StatCard.md) | Reusable stat card with label, numeric value, icon, and optional trend indicator |
| [WidgetGrid.md](frontend/components/dashboard/WidgetGrid.md) | Responsive CSS grid layout container for dashboard widgets |

### Geofencing

| File | Purpose |
|------|---------|
| [FenceScopeSelector.md](frontend/components/geofencing/FenceScopeSelector.md) | Scope selector (environment/group/device) for geofence targeting with debounced device search |
| [GeofenceEditor.md](frontend/components/geofencing/GeofenceEditor.md) | Full-screen modal form for creating/editing geofences with map preview and action config |
| [GeofenceMap.md](frontend/components/geofencing/GeofenceMap.md) | Google Maps component rendering geofence circles, device markers, and click-to-place |

### Workflows

| File | Purpose |
|------|---------|
| [ActionSelector.md](frontend/components/workflows/ActionSelector.md) | Grid-based selector for workflow action type with inline configuration panels |
| [ConditionBuilder.md](frontend/components/workflows/ConditionBuilder.md) | Dynamic condition builder with multiple fields, operators, and value types joined by AND |
| [ExecutionHistory.md](frontend/components/workflows/ExecutionHistory.md) | Timeline-style workflow execution history with status, device info, and result payloads |
| [TriggerSelector.md](frontend/components/workflows/TriggerSelector.md) | Grid-based selector for workflow trigger type with inline trigger-specific config |

### Enrollment

| File | Purpose |
|------|---------|
| [EnrollmentQrPreview.md](frontend/components/enrollment/EnrollmentQrPreview.md) | Renders a QR code from a string value using `qrcode` library with loading/error states |
| [TokenCreator.md](frontend/components/enrollment/TokenCreator.md) | Modal for creating an enrollment token with group, personal usage, expiry, and Wi-Fi config |

### Settings

| File | Purpose |
|------|---------|
| [SignupLinkSettings.md](frontend/components/settings/SignupLinkSettings.md) | Manages signup link lifecycle: creation, editing, enable/disable, regeneration, deletion |

### Users

| File | Purpose |
|------|---------|
| [UserAccessAssignmentsModal.md](frontend/components/users/UserAccessAssignmentsModal.md) | Modal for managing user role, access scope, environment grants, and group grants |

### Deployment

| File | Purpose |
|------|---------|
| [DeploymentProgress.md](frontend/components/deployment/DeploymentProgress.md) | Displays deployment job progress with status bar, error log, cancel/rollback actions |

---

## Frontend -- Pages

| File | Purpose |
|------|---------|
| [App.md](frontend/App.md) | Root application component defining all routes, lazy-loaded pages, and route guards |
| [main.md](frontend/main.md) | Application entry point mounting the React root with providers and global configuration |
| [Applications.md](frontend/pages/Applications.md) | App management: searching, importing, deploying, and configuring Android apps |
| [AuditLog.md](frontend/pages/AuditLog.md) | Paginated audit log viewer with action-type filtering and live refresh |
| [Dashboard.md](frontend/pages/Dashboard.md) | Main dashboard: fleet statistics, compliance rates, enrollment trends, recent events |
| [DeviceDetail.md](frontend/pages/DeviceDetail.md) | Single-device detail page with tabbed views for overview, info, policy, apps, audit, operations |
| [Devices.md](frontend/pages/Devices.md) | Paginated device list with filtering, sorting, row selection, and bulk actions |
| [EnrollmentTokens.md](frontend/pages/EnrollmentTokens.md) | Enrollment token management with creation, sync, QR preview, bulk selection, deletion |
| [EnterpriseCallback.md](frontend/pages/EnterpriseCallback.md) | Callback handler for completing Android Enterprise binding after Google admin signup |
| [EnvironmentSetup.md](frontend/pages/EnvironmentSetup.md) | Post-registration setup wizard for environment creation and enterprise binding |
| [Geofencing.md](frontend/pages/Geofencing.md) | Geofence management with two-panel layout: data table and interactive map |
| [Groups.md](frontend/pages/Groups.md) | Hierarchical group management with CRUD, bulk operations, policy assignment, detail drawer |
| [InviteAccept.md](frontend/pages/InviteAccept.md) | Invite acceptance handling workspace and platform invitations with inline registration |
| [JoinSignup.md](frontend/pages/JoinSignup.md) | Public signup page for users joining via a signup link with scope context display |
| [Licenses.md](frontend/pages/Licenses.md) | License/billing management with workspace and environment tabs for plans, grants, invoices |
| [Login.md](frontend/pages/Login.md) | Authentication page supporting magic link, password, and TOTP two-factor flows |
| [Networks.md](frontend/pages/Networks.md) | Wi-Fi (ONC) and APN network profile deployment management |
| [Policies.md](frontend/pages/Policies.md) | Policy list management with filtering, search, bulk actions, and delete |
| [PolicyComponents.md](frontend/pages/PolicyComponents.md) | CRUD for reusable policy configuration fragments assignable to multiple policies |
| [PolicyEditor.md](frontend/pages/PolicyEditor.md) | Three-panel policy editor with form/JSON editing, AMAPI push, versioning, derivatives |
| [Register.md](frontend/pages/Register.md) | User registration supporting self-serve and invite-based onboarding with workspace creation |
| [Reports.md](frontend/pages/Reports.md) | Data export for devices, policies, audit logs, and applications in CSV or JSON |
| [ResetPassword.md](frontend/pages/ResetPassword.md) | Multi-step password reset: email request, token-based reset, and MFA verification |
| [Roles.md](frontend/pages/Roles.md) | RBAC permission matrix editor with role-first and raw matrix views |
| [Settings.md](frontend/pages/Settings.md) | Multi-tab settings: workspace config, environment management, API keys, user profile |
| [SigninEnroll.md](frontend/pages/SigninEnroll.md) | Public device enrollment page for Android Enterprise sign-in URL provisioning |
| [Superadmin.md](frontend/pages/Superadmin.md) | Platform admin pages: dashboard stats, workspace management, user management, statistics |
| [Users.md](frontend/pages/Users.md) | Workspace user management with invite flow, access assignment editing, bulk ops |
| [WorkflowBuilder.md](frontend/pages/WorkflowBuilder.md) | Accordion-based workflow editor for event-driven automation workflows |
| [Workflows.md](frontend/pages/Workflows.md) | Workflow list management with filtering, bulk actions, and inline toggle |

---

## Frontend -- Layouts

| File | Purpose |
|------|---------|
| [GuestLayout.md](frontend/layouts/GuestLayout.md) | Minimal centered layout for unauthenticated pages with brand name and tagline |
| [MainLayout.md](frontend/layouts/MainLayout.md) | Primary authenticated layout with sidebar nav, global search, context switcher, user menu |
| [SuperadminLayout.md](frontend/layouts/SuperadminLayout.md) | Dark-themed superadmin layout with access gating, dedicated sidebar, and "Back to Console" link |
