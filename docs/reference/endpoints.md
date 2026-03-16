# Endpoints index

This is a routing-focused index of the public HTTP surface area exposed via `netlify.toml` redirects.

- **Routes source:** `netlify.toml`
- **Handler source:** `netlify/functions/<function>.ts`

See also:

- [Endpoints (detailed)](./endpoints-detailed.md) — best-effort metadata extracted from code
- `docs/reference/endpoints-metadata.json` — raw extracted metadata

> Notes:
> - Many routes use splats (e.g. `/api/workspaces/*`). These should be treated as multiple logical endpoints handled by one function.
> - Authentication/RBAC requirements are enforced in code; this page is a navigation aid.
> - `netlify/functions/app-details.ts` exists in the codebase but has no dedicated route in `netlify.toml`. Comments in `netlify.toml` reference it but the catch-all `/api/apps/*` resolves to `app-crud`. App detail lookups by package name are handled within `app-crud`.

> Naming note: this project uses both `/api/enrolment/*` (British spelling) and references to "enrollment" in code/docs. Treat them as the same functional domain.

## Domain groupings (quick navigation)

- Auth: `/api/auth/*`
- Workspaces/users: `/api/workspaces/*`, `/api/invites/*`
- Environments: `/api/environments/*`
- Groups: `/api/groups/*`
- Devices: `/api/devices/*`
- Policies/components: `/api/policies/*`, `/api/components/*`
- Apps: `/api/apps/*`
- Networks: `/api/networks/*`
- Enrollment: `/api/enrolment/*`
- Certificates: `/api/certificates/*`
- Workflows: `/api/workflows/*`
- Geofences: `/api/geofences/*`
- Audit log: `/api/audit-log`
- Licensing/billing: `/api/licenses/*`, `/api/workspace-billing/*`, `/api/licensing/*`, `/api/stripe/*`
- Superadmin/operator: `/api/superadmin/*`, `/api/superadmin/billing/*`, `/api/migrate`

---

## `UNKNOWN`

- `/*` → `/index.html` (status 200)

## `api-key-crud`

- `/api/api-keys/*` → `/.netlify/functions/api-key-crud` (status 200)

## `app-crud`

- `/api/apps/*` → `/.netlify/functions/app-crud` (status 200)
- `/api/apps/*/configs` → `/.netlify/functions/app-crud` (status 200)
- `/api/apps/*/configs/*` → `/.netlify/functions/app-crud` (status 200)
- `/api/apps/catalog` → `/.netlify/functions/app-crud` (status 200)
- `/api/apps/deployments/*` → `/.netlify/functions/app-crud` (status 200)
- `/api/apps/import` → `/.netlify/functions/app-crud` (status 200)

## `app-deploy`

- `/api/apps/deploy` → `/.netlify/functions/app-deploy` (status 200)

## `app-list`

- `/api/apps/list` → `/.netlify/functions/app-list` (status 200)

## `app-search`

- `/api/apps/search` → `/.netlify/functions/app-search` (status 200)

## `app-web-token`

- `/api/apps/web-token` → `/.netlify/functions/app-web-token` (status 200)

## `audit-log`

- `/api/audit-log` → `/.netlify/functions/audit-log` (status 200)
- `/api/audit/log` → `/.netlify/functions/audit-log` (status 200)

## `auth-config`

- `/api/auth/config` → `/.netlify/functions/auth-config` (status 200)

## `auth-login`

- `/api/auth/login` → `/.netlify/functions/auth-login` (status 200)

## `auth-logout`

- `/api/auth/logout` → `/.netlify/functions/auth-logout` (status 200)

## `auth-magic-link-complete`

- `/api/auth/magic-link-complete` → `/.netlify/functions/auth-magic-link-complete` (status 200)

## `auth-magic-link-start`

- `/api/auth/magic-link-start` → `/.netlify/functions/auth-magic-link-start` (status 200)

## `auth-magic-link-verify`

- `/api/auth/magic-link-verify` → `/.netlify/functions/auth-magic-link-verify` (status 200)

## `auth-password-change`

- `/api/auth/password-change` → `/.netlify/functions/auth-password-change` (status 200)

## `auth-password-reset-complete`

- `/api/auth/password-reset-complete` → `/.netlify/functions/auth-password-reset-complete` (status 200)

## `auth-password-reset-start`

- `/api/auth/password-reset-start` → `/.netlify/functions/auth-password-reset-start` (status 200)

## `auth-register`

- `/api/auth/register` → `/.netlify/functions/auth-register` (status 200)

## `auth-session`

- `/api/auth/session` → `/.netlify/functions/auth-session` (status 200)

## `auth-totp-setup`

- `/api/auth/totp-setup` → `/.netlify/functions/auth-totp-setup` (status 200)

## `auth-totp-verify`

- `/api/auth/totp-verify` → `/.netlify/functions/auth-totp-verify` (status 200)
- `/api/auth/totp-verify/disable` → `/.netlify/functions/auth-totp-verify` (status 200)
- `/api/auth/totp-verify/verify` → `/.netlify/functions/auth-totp-verify` (status 200)

## `certificate-crud`

- `/api/certificates/*` → `/.netlify/functions/certificate-crud` (status 200)

## `component-assign`

- `/api/components/assign` → `/.netlify/functions/component-assign` (status 200)
- `/api/components/policy/*` → `/.netlify/functions/component-assign` (status 200)
- `/api/components/unassign` → `/.netlify/functions/component-assign` (status 200)

## `component-crud`

- `/api/components/*` → `/.netlify/functions/component-crud` (status 200)

## `dashboard-data`

- `/api/dashboard/data` → `/.netlify/functions/dashboard-data` (status 200)

## `deployment-jobs`

- `/api/deployments` → `/.netlify/functions/deployment-jobs` (status 200)
- `/api/deployments/*` → `/.netlify/functions/deployment-jobs` (status 200)

## `device-bulk`

- `/api/devices/bulk` → `/.netlify/functions/device-bulk` (status 200)

## `device-command`

- `/api/devices/command` → `/.netlify/functions/device-command` (status 200)

## `device-get`

- `/api/devices/*` → `/.netlify/functions/device-get/:splat` (status 200)

## `device-list`

- `/api/devices/list` → `/.netlify/functions/device-list` (status 200)

## `device-operations`

- `/api/devices/operations` → `/.netlify/functions/device-operations` (status 200)
- `/api/devices/operations/*` → `/.netlify/functions/device-operations` (status 200)

## `enrollment-create`

- `/api/enrolment/create` → `/.netlify/functions/enrollment-create` (status 200)

## `enrollment-crud`

- `/api/enrolment/*` → `/.netlify/functions/enrollment-crud` (status 200)

## `enrollment-list`

- `/api/enrolment/list` → `/.netlify/functions/enrollment-list` (status 200)

## `enrollment-sync`

- `/api/enrolment/sync` → `/.netlify/functions/enrollment-sync` (status 200)

## `environment-bind`

- `/api/environments/bind` → `/.netlify/functions/environment-bind` (status 200)

## `environment-crud`

- `/api/environments/*` → `/.netlify/functions/environment-crud` (status 200)

## `environment-enterprise`

- `/api/environments/enterprise` → `/.netlify/functions/environment-enterprise` (status 200)

## `environment-renew`

- `/api/environments/renew` → `/.netlify/functions/environment-renew` (status 200)

## `geofence-crud`

- `/api/geofences/*` → `/.netlify/functions/geofence-crud` (status 200)

## `group-crud`

- `/api/groups/*` → `/.netlify/functions/group-crud` (status 200)

## `license-assign`

- `/api/licenses/assign` → `/.netlify/functions/license-assign` (status 200)
- `/api/licenses/unassign` → `/.netlify/functions/license-assign` (status 200)

## `license-grants`

- `/api/licenses/grants` → `/.netlify/functions/license-grants` (status 200)
- `/api/licenses/grants/*` → `/.netlify/functions/license-grants` (status 200)

## `license-plans`

- `/api/licenses/plans` → `/.netlify/functions/license-plans` (status 200)

## `license-settings`

- `/api/licenses/settings` → `/.netlify/functions/license-settings` (status 200)

## `license-status`

- `/api/licenses/status` → `/.netlify/functions/license-status` (status 200)

## `licensing-reconcile`

- `/api/licensing/reconcile` → `/.netlify/functions/licensing-reconcile` (status 200)

## `migrate`

- `/api/migrate` → `/.netlify/functions/migrate` (status 200)

## `network-crud`

- `/api/networks/*` → `/.netlify/functions/network-crud` (status 200)

## `network-deploy`

- `/api/networks/deploy` → `/.netlify/functions/network-deploy` (status 200)

## `network-list`

- `/api/networks/list` → `/.netlify/functions/network-list` (status 200)

## `policy-assign`

- `/api/policies/assign` → `/.netlify/functions/policy-assign` (status 200)
- `/api/policies/assignments` → `/.netlify/functions/policy-assign` (status 200)
- `/api/policies/effective` → `/.netlify/functions/policy-assign` (status 200)
- `/api/policies/unassign` → `/.netlify/functions/policy-assign` (status 200)

## `policy-clone`

- `/api/policies/clone` → `/.netlify/functions/policy-clone` (status 200)

## `policy-crud`

- `/api/policies/*` → `/.netlify/functions/policy-crud` (status 200)

## `policy-overrides`

- `/api/policies/overrides` → `/.netlify/functions/policy-overrides` (status 200)
- `/api/policies/overrides/*` → `/.netlify/functions/policy-overrides` (status 200)

## `policy-versions`

- `/api/policies/versions` → `/.netlify/functions/policy-versions` (status 200)

## `pubsub-webhook`

- `/api/pubsub/webhook` → `/.netlify/functions/pubsub-webhook` (status 200)

## `report-download`

- `/api/reports/download` → `/.netlify/functions/report-download` (status 200)

## `report-export`

- `/api/reports/export` → `/.netlify/functions/report-export` (status 200)

## `roles-rbac`

- `/api/roles/rbac` → `/.netlify/functions/roles-rbac` (status 200)

## `signin-config`

- `/api/signin/config` → `/.netlify/functions/signin-config` (status 200)

## `signin-enroll`

- `/api/signin/enroll` → `/.netlify/functions/signin-enroll` (status 200)

## `signup-link-crud`

- `/api/signup-links` → `/.netlify/functions/signup-link-crud` (status 200)
- `/api/signup-links/*` → `/.netlify/functions/signup-link-crud` (status 200)

## `signup-link-resolve`

- `/api/signup-links/resolve/*` → `/.netlify/functions/signup-link-resolve` (status 200)

## `stripe-checkout`

- `/api/stripe/checkout` → `/.netlify/functions/stripe-checkout` (status 200)

## `stripe-portal`

- `/api/stripe/portal` → `/.netlify/functions/stripe-portal` (status 200)

## `stripe-webhook`

- `/api/stripe/webhook` → `/.netlify/functions/stripe-webhook` (status 200)

## `superadmin-actions`

- `/api/superadmin/actions` → `/.netlify/functions/superadmin-actions` (status 200)

## `superadmin-billing`

- `/api/superadmin/billing/*` → `/.netlify/functions/superadmin-billing` (status 200)

## `superadmin-settings`

- `/api/superadmin/settings` → `/.netlify/functions/superadmin-settings` (status 200)

## `superadmin-stats`

- `/api/superadmin/stats` → `/.netlify/functions/superadmin-stats` (status 200)

## `superadmin-users`

- `/api/superadmin/users` → `/.netlify/functions/superadmin-users` (status 200)

## `superadmin-workspaces`

- `/api/superadmin/workspaces` → `/.netlify/functions/superadmin-workspaces` (status 200)
- `/api/superadmin/workspaces/*` → `/.netlify/functions/superadmin-workspaces` (status 200)

## `workflow-crud`

- `/api/workflows/*` → `/.netlify/functions/workflow-crud` (status 200)

## `workspace-billing`

- `/api/workspace-billing/*` → `/.netlify/functions/workspace-billing` (status 200)

## `workspace-billing-webhook`

- `/api/workspace-billing/webhook` → `/.netlify/functions/workspace-billing-webhook` (status 200)

## `workspace-crud`

- `/api/workspaces/*` → `/.netlify/functions/workspace-crud` (status 200)

## `workspace-invite`

- `/api/invites/*` → `/.netlify/functions/workspace-invite` (status 200)
- `/api/workspaces/invite` → `/.netlify/functions/workspace-invite` (status 200)

## `workspace-users`

- `/api/workspaces/users` → `/.netlify/functions/workspace-users` (status 200)
- `/api/workspaces/users/*` → `/.netlify/functions/workspace-users` (status 200)

