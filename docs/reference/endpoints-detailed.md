# Endpoints (detailed)

This page augments `docs/reference/endpoints.md` with **best-effort** metadata extracted from handler code.

What this includes:
- Does the handler call `requireAuth()` (auth required)
- Best-effort extraction of RBAC checks (workspace/environment)
- Detected request methods (heuristic)

What this does **not** guarantee:
- This extraction can produce false negatives (e.g. auth/permissions enforced by a shared helper not detected by simple string search).
- Complete method coverage (handlers may support multiple methods via routing inside the file)
- Complete RBAC mapping (some permissions are enforced indirectly or via helpers)

> **Known false negative:** Superadmin endpoints (`superadmin-*`) show `auth required: no/unknown` because they use `requireSuperadmin()` rather than `requireAuth()`. All superadmin handlers are authenticated — the heuristic just does not detect the alternate helper name.

## `api-key-crud`

- File: `netlify/functions/api-key-crud.ts`
- Routes:
  - `/api/api-keys/*`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`, `POST`
- RBAC checks detected:
  - workspace: `workspace.manage_settings`
  - workspace: `workspace.manage_settings`

## `app-crud`

- File: `netlify/functions/app-crud.ts`
- Routes:
  - `/api/apps/*`
  - `/api/apps/*/configs`
  - `/api/apps/*/configs/*`
  - `/api/apps/catalog`
  - `/api/apps/deployments/*`
  - `/api/apps/import`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `POST`, `PUT`
- RBAC checks detected:
  - environment: `environment.read`
  - environment: `environment.write`
  - environment: `environment.read`
  - environment: `environment.write`
  - environment: `environment.write`
  - environment: `environment.write`
  - environment: `environment.write`
  - environment: `environment.write`
  - environment: `environment.read`
  - environment: `environment.write`
  - environment: `environment.write`

## `app-deploy`

- File: `netlify/functions/app-deploy.ts`
- Routes:
  - `/api/apps/deploy`
- Auth required (requireAuth): **yes**
- Methods detected: `POST`
- RBAC checks detected:
  - environment: `environment.write`

## `app-list`

- File: `netlify/functions/app-list.ts`
- Routes:
  - `/api/apps/list`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`
- RBAC checks detected:
  - environment: `environment.read`

## `app-search`

- File: `netlify/functions/app-search.ts`
- Routes:
  - `/api/apps/search`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`
- RBAC checks detected:
  - environment: `environment.read`

## `app-web-token`

- File: `netlify/functions/app-web-token.ts`
- Routes:
  - `/api/apps/web-token`
- Auth required (requireAuth): **yes**
- Methods detected: `POST`
- RBAC checks detected:
  - environment: `environment.write`

## `audit-log`

- File: `netlify/functions/audit-log.ts`
- Routes:
  - `/api/audit-log`
  - `/api/audit/log`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`

## `auth-config`

- File: `netlify/functions/auth-config.ts`
- Routes:
  - `/api/auth/config`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `GET`

## `auth-login`

- File: `netlify/functions/auth-login.ts`
- Routes:
  - `/api/auth/login`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `POST`

## `auth-logout`

- File: `netlify/functions/auth-logout.ts`
- Routes:
  - `/api/auth/logout`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `POST`

## `auth-magic-link-complete`

- File: `netlify/functions/auth-magic-link-complete.ts`
- Routes:
  - `/api/auth/magic-link-complete`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `POST`

## `auth-magic-link-start`

- File: `netlify/functions/auth-magic-link-start.ts`
- Routes:
  - `/api/auth/magic-link-start`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `POST`

## `auth-magic-link-verify`

- File: `netlify/functions/auth-magic-link-verify.ts`
- Routes:
  - `/api/auth/magic-link-verify`
- Auth required (requireAuth): **no/unknown**

## `auth-password-change`

- File: `netlify/functions/auth-password-change.ts`
- Routes:
  - `/api/auth/password-change`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `POST`

## `auth-password-reset-complete`

- File: `netlify/functions/auth-password-reset-complete.ts`
- Routes:
  - `/api/auth/password-reset-complete`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `POST`

## `auth-password-reset-start`

- File: `netlify/functions/auth-password-reset-start.ts`
- Routes:
  - `/api/auth/password-reset-start`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `POST`

## `auth-register`

- File: `netlify/functions/auth-register.ts`
- Routes:
  - `/api/auth/register`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `POST`

## `auth-session`

- File: `netlify/functions/auth-session.ts`
- Routes:
  - `/api/auth/session`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `GET`, `POST`

## `auth-totp-setup`

- File: `netlify/functions/auth-totp-setup.ts`
- Routes:
  - `/api/auth/totp-setup`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `POST`

## `auth-totp-verify`

- File: `netlify/functions/auth-totp-verify.ts`
- Routes:
  - `/api/auth/totp-verify`
  - `/api/auth/totp-verify/disable`
  - `/api/auth/totp-verify/verify`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `POST`

## `certificate-crud`

- File: `netlify/functions/certificate-crud.ts`
- Routes:
  - `/api/certificates/*`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `POST`

## `component-assign`

- File: `netlify/functions/component-assign.ts`
- Routes:
  - `/api/components/assign`
  - `/api/components/policy/*`
  - `/api/components/unassign`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`, `POST`

## `component-crud`

- File: `netlify/functions/component-crud.ts`
- Routes:
  - `/api/components/*`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `POST`, `PUT`

## `dashboard-data`

- File: `netlify/functions/dashboard-data.ts`
- Routes:
  - `/api/dashboard/data`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`

## `deployment-jobs`

- File: `netlify/functions/deployment-jobs.ts`
- Routes:
  - `/api/deployments`
  - `/api/deployments/*`
- Auth required (requireAuth): **yes**
- Internal-only hint: **yes**
- RBAC checks detected:
  - environment: `environment.write`
  - environment: `environment.read`
  - environment: `environment.read`
  - environment: `environment.write`
  - environment: `environment.write`

## `device-bulk`

- File: `netlify/functions/device-bulk.ts`
- Routes:
  - `/api/devices/bulk`
- Auth required (requireAuth): **yes**
- Internal-only hint: **yes**
- Methods detected: `POST`

## `device-command`

- File: `netlify/functions/device-command.ts`
- Routes:
  - `/api/devices/command`
- Auth required (requireAuth): **yes**
- Methods detected: `POST`

## `device-get`

- File: `netlify/functions/device-get.ts`
- Routes:
  - `/api/devices/*`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `POST`, `PUT`

## `device-list`

- File: `netlify/functions/device-list.ts`
- Routes:
  - `/api/devices/list`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`

## `device-operations`

- File: `netlify/functions/device-operations.ts`
- Routes:
  - `/api/devices/operations`
  - `/api/devices/operations/*`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`, `POST`

## `enrollment-create`

- File: `netlify/functions/enrollment-create.ts`
- Routes:
  - `/api/enrolment/create`
- Auth required (requireAuth): **yes**
- Methods detected: `POST`
- RBAC checks detected:
  - environment: `environment.write`

## `enrollment-crud`

- File: `netlify/functions/enrollment-crud.ts`
- Routes:
  - `/api/enrolment/*`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `POST`
- RBAC checks detected:
  - environment: `environment.write`
  - environment: `environment.read`
  - environment: `environment.write`

## `enrollment-list`

- File: `netlify/functions/enrollment-list.ts`
- Routes:
  - `/api/enrolment/list`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`
- RBAC checks detected:
  - environment: `environment.read`

## `enrollment-sync`

- File: `netlify/functions/enrollment-sync.ts`
- Routes:
  - `/api/enrolment/sync`
- Auth required (requireAuth): **yes**
- Methods detected: `POST`
- RBAC checks detected:
  - environment: `environment.write`

## `environment-bind`

- File: `netlify/functions/environment-bind.ts`
- Routes:
  - `/api/environments/bind`
- Auth required (requireAuth): **yes**
- Methods detected: `POST`

## `environment-crud`

- File: `netlify/functions/environment-crud.ts`
- Routes:
  - `/api/environments/*`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `POST`, `PUT`
- RBAC checks detected:
  - workspace: `environment.read`
  - workspace: `environment.write`
  - environment: `environment.read`
  - environment: `environment.write`
  - environment: `environment.delete`

## `environment-enterprise`

- File: `netlify/functions/environment-enterprise.ts`
- Routes:
  - `/api/environments/enterprise`
- Auth required (requireAuth): **yes**
- Internal-only hint: **yes**
- Methods detected: `POST`

## `environment-renew`

- File: `netlify/functions/environment-renew.ts`
- Routes:
  - `/api/environments/renew`
- Auth required (requireAuth): **yes**
- Methods detected: `POST`

## `geofence-crud`

- File: `netlify/functions/geofence-crud.ts`
- Routes:
  - `/api/geofences/*`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `POST`, `PUT`

## `group-crud`

- File: `netlify/functions/group-crud.ts`
- Routes:
  - `/api/groups/*`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `POST`, `PUT`

## `license-assign`

- File: `netlify/functions/license-assign.ts`
- Routes:
  - `/api/licenses/assign`
  - `/api/licenses/unassign`
- Auth required (requireAuth): **yes**
- Methods detected: `POST`
- RBAC checks detected:
  - environment: `environment.write`

## `license-grants`

- File: `netlify/functions/license-grants.ts`
- Routes:
  - `/api/licenses/grants`
  - `/api/licenses/grants/*`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`, `POST`
- RBAC checks detected:
  - workspace: `workspace.read`
  - workspace: `billing.license_view`
  - workspace: `workspace.read`
  - workspace: `billing.billing_manage`
  - environment: `environment.read`

## `license-plans`

- File: `netlify/functions/license-plans.ts`
- Routes:
  - `/api/licenses/plans`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `PUT`
- RBAC checks detected:
  - workspace: `workspace.read`
  - workspace: `billing.license_view`
  - environment: `environment.read`

## `license-settings`

- File: `netlify/functions/license-settings.ts`
- Routes:
  - `/api/licenses/settings`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`, `PUT`
- RBAC checks detected:
  - workspace: `workspace.read`
  - environment: `environment.read`

## `license-status`

- File: `netlify/functions/license-status.ts`
- Routes:
  - `/api/licenses/status`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`
- RBAC checks detected:
  - workspace: `workspace.read`
  - workspace: `billing.license_view`
  - environment: `environment.read`
  - environment: `environment.read`

## `licensing-reconcile`

- File: `netlify/functions/licensing-reconcile.ts`
- Routes:
  - `/api/licensing/reconcile`
- Auth required (requireAuth): **no/unknown**
- Internal-only hint: **yes**
- Methods detected: `POST`

## `migrate`

- File: `netlify/functions/migrate.ts`
- Routes:
  - `/api/migrate`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `GET`

## `network-crud`

- File: `netlify/functions/network-crud.ts`
- Routes:
  - `/api/networks/*`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `POST`, `PUT`
- RBAC checks detected:
  - environment: `environment.write`
  - environment: `environment.read`
  - environment: `environment.write`
  - environment: `environment.write`

## `network-deploy`

- File: `netlify/functions/network-deploy.ts`
- Routes:
  - `/api/networks/deploy`
- Auth required (requireAuth): **yes**
- Methods detected: `POST`
- RBAC checks detected:
  - environment: `environment.write`

## `network-list`

- File: `netlify/functions/network-list.ts`
- Routes:
  - `/api/networks/list`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`
- RBAC checks detected:
  - environment: `environment.read`

## `policy-assign`

- File: `netlify/functions/policy-assign.ts`
- Routes:
  - `/api/policies/assign`
  - `/api/policies/assignments`
  - `/api/policies/effective`
  - `/api/policies/unassign`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`, `POST`

## `policy-clone`

- File: `netlify/functions/policy-clone.ts`
- Routes:
  - `/api/policies/clone`
- Auth required (requireAuth): **yes**
- Methods detected: `POST`

## `policy-crud`

- File: `netlify/functions/policy-crud.ts`
- Routes:
  - `/api/policies/*`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `POST`, `PUT`

## `policy-overrides`

- File: `netlify/functions/policy-overrides.ts`
- Routes:
  - `/api/policies/overrides`
  - `/api/policies/overrides/*`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `PUT`

## `policy-versions`

- File: `netlify/functions/policy-versions.ts`
- Routes:
  - `/api/policies/versions`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`

## `pubsub-webhook`

- File: `netlify/functions/pubsub-webhook.ts`
- Routes:
  - `/api/pubsub/webhook`
- Auth required (requireAuth): **no/unknown**
- Internal-only hint: **yes**
- Methods detected: `POST`

## `report-download`

- File: `netlify/functions/report-download.ts`
- Routes:
  - `/api/reports/download`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`

## `report-export`

- File: `netlify/functions/report-export.ts`
- Routes:
  - `/api/reports/export`
- Auth required (requireAuth): **yes**
- Methods detected: `POST`

## `roles-rbac`

- File: `netlify/functions/roles-rbac.ts`
- Routes:
  - `/api/roles/rbac`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `PUT`

## `signin-config`

- File: `netlify/functions/signin-config.ts`
- Routes:
  - `/api/signin/config`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `PUT`
- RBAC checks detected:
  - environment: `environment.read`

## `signin-enroll`

- File: `netlify/functions/signin-enroll.ts`
- Routes:
  - `/api/signin/enroll`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `POST`

## `signup-link-crud`

- File: `netlify/functions/signup-link-crud.ts`
- Routes:
  - `/api/signup-links`
  - `/api/signup-links/*`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `PATCH`, `POST`
- RBAC checks detected:
  - workspace: `invite.read`
  - workspace: `invite.write`
  - workspace: `invite.write`
  - workspace: `invite.delete`

## `signup-link-resolve`

- File: `netlify/functions/signup-link-resolve.ts`
- Routes:
  - `/api/signup-links/resolve/*`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `GET`

## `stripe-checkout`

- File: `netlify/functions/stripe-checkout.ts`
- Routes:
  - `/api/stripe/checkout`
- Auth required (requireAuth): **yes**
- Methods detected: `POST`
- RBAC checks detected:
  - workspace: `workspace.read`
  - workspace: `billing.billing_manage`

## `stripe-portal`

- File: `netlify/functions/stripe-portal.ts`
- Routes:
  - `/api/stripe/portal`
- Auth required (requireAuth): **yes**
- Methods detected: `POST`
- RBAC checks detected:
  - workspace: `workspace.read`
  - workspace: `billing.billing_manage`

## `stripe-webhook`

- File: `netlify/functions/stripe-webhook.ts`
- Routes:
  - `/api/stripe/webhook`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `POST`

## `superadmin-actions`

- File: `netlify/functions/superadmin-actions.ts`
- Routes:
  - `/api/superadmin/actions`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `POST`

## `superadmin-billing`

- File: `netlify/functions/superadmin-billing.ts`
- Routes:
  - `/api/superadmin/billing/*`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `GET`, `POST`

## `superadmin-settings`

- File: `netlify/functions/superadmin-settings.ts`
- Routes:
  - `/api/superadmin/settings`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `GET`, `POST`

## `superadmin-stats`

- File: `netlify/functions/superadmin-stats.ts`
- Routes:
  - `/api/superadmin/stats`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `GET`

## `superadmin-users`

- File: `netlify/functions/superadmin-users.ts`
- Routes:
  - `/api/superadmin/users`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `GET`

## `superadmin-workspaces`

- File: `netlify/functions/superadmin-workspaces.ts`
- Routes:
  - `/api/superadmin/workspaces`
  - `/api/superadmin/workspaces/*`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `GET`

## `workflow-crud`

- File: `netlify/functions/workflow-crud.ts`
- Routes:
  - `/api/workflows/*`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `POST`, `PUT`
- RBAC checks detected:
  - environment: `environment.write`
  - environment: `environment.read`
  - environment: `environment.read`
  - environment: `environment.write`
  - environment: `environment.write`
  - environment: `environment.delete`
  - environment: `environment.write`
  - environment: `environment.write`

## `workspace-billing`

- File: `netlify/functions/workspace-billing.ts`
- Routes:
  - `/api/workspace-billing/*`
- Auth required (requireAuth): **yes**
- RBAC checks detected:
  - workspace: `workspace.read`
  - workspace: `workspace.read`
  - workspace: `billing.billing_view`
  - workspace: `workspace.read`
  - workspace: `billing.billing_customer`
  - workspace: `workspace.read`
  - workspace: `billing.billing_view`
  - workspace: `workspace.read`
  - workspace: `billing.billing_manage`
  - workspace: `workspace.read`
  - workspace: `billing.billing_manage`

## `workspace-billing-webhook`

- File: `netlify/functions/workspace-billing-webhook.ts`
- Routes:
  - `/api/workspace-billing/webhook`
- Auth required (requireAuth): **no/unknown**
- Methods detected: `POST`

## `workspace-crud`

- File: `netlify/functions/workspace-crud.ts`
- Routes:
  - `/api/workspaces/*`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`, `POST`, `PUT`
- RBAC checks detected:
  - workspace: `workspace.manage_settings`

## `workspace-invite`

- File: `netlify/functions/workspace-invite.ts`
- Routes:
  - `/api/invites/*`
  - `/api/workspaces/invite`
- Auth required (requireAuth): **yes**
- Methods detected: `GET`, `POST`
- RBAC checks detected:
  - workspace: `invite.write`

## `workspace-users`

- File: `netlify/functions/workspace-users.ts`
- Routes:
  - `/api/workspaces/users`
  - `/api/workspaces/users/*`
- Auth required (requireAuth): **yes**
- Methods detected: `DELETE`, `GET`, `POST`, `PUT`

