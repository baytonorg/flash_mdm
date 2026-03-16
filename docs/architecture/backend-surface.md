# Backend surface overview

This page summarises backend functions/endpoints at a domain level to help reviewers and engineers orient quickly.

For route-level detail, see: `docs/reference/endpoints.md`.

## Auth

- `auth-config`
- `auth-login`
- `auth-logout`
- `auth-magic-link-complete`
- `auth-magic-link-start`
- `auth-magic-link-verify`
- `auth-password-change`
- `auth-password-reset-complete`
- `auth-password-reset-start`
- `auth-register`
- `auth-session`
- `auth-totp-setup`
- `auth-totp-verify`

## Workspaces

- `workspace-billing`
- `workspace-billing-webhook`
- `workspace-crud`
- `workspace-invite`
- `workspace-users`

## Environments

- `environment-bind`
- `environment-crud`
- `environment-enterprise`
- `environment-renew`
- `environment-zero-touch`

## Groups

- `group-crud`

## Devices

- `device-bulk`
- `device-command`
- `device-get`
- `device-list`
- `device-operations`

## Policies

- `policy-assign`
- `policy-clone`
- `policy-crud`
- `policy-overrides`
- `policy-versions`

## Components

- `component-assign`
- `component-crud`

## Apps

- `app-crud`
- `app-deploy`
- `app-details`
- `app-feedback`
- `app-list`
- `app-search`
- `app-web-token`

## Networks

- `network-crud`
- `network-deploy`
- `network-list`

## Enrollment

- `enrollment-create`
- `enrollment-crud`
- `enrollment-list`
- `enrollment-sync`

## Certificates

- `certificate-crud`

## Workflows

- `workflow-cron-scheduled`
- `workflow-crud`
- `workflow-evaluate-background`

## Geofences

- `geofence-check-scheduled`
- `geofence-crud`

## Audit

- `audit-log`

## Dashboard

- `dashboard-data`

## Licenses Billing

- `license-assign`
- `license-grants`
- `license-plans`
- `license-settings`
- `license-status`
- `licensing-reconcile`
- `licensing-reconcile-scheduled`
- `superadmin-billing`

## Stripe

- `stripe-checkout`
- `stripe-portal`
- `stripe-webhook`

## Superadmin

- `migrate`
- `superadmin-actions`
- `superadmin-settings`
- `superadmin-stats`
- `superadmin-users`
- `superadmin-workspaces`

## AI Assistant (Flashi)

- `flashagent-chat`
- `flashagent-chat-history`
- `flashagent-download`
- `flashagent-settings`
- `flashagent-workspace-settings`
- `mcp-amapi`

## Infra Jobs

- `cleanup-scheduled`
- `deployment-jobs-background`
- `sync-process-background`
- `sync-reconcile-scheduled`

## Misc

- `api-key-crud`
- `deployment-jobs`
- `pubsub-webhook`
- `report-download`
- `report-export`
- `roles-rbac`
- `signin-config`
- `signin-enroll`
- `signup-link-crud`
- `signup-link-resolve`
