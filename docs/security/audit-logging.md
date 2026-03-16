# Audit logging

## What is logged

Flash MDM writes server-side audit log entries to the `audit_log` table for sensitive operations, including:

- Auth events: login, login failures, TOTP enable/disable, backup code use, password reset, logout
- Workspace/environment/group CRUD operations
- User role and access changes
- Device commands and bulk operations
- Policy and certificate changes
- API key creation and revocation
- RBAC permission matrix updates

## Schema

Each entry captures:

| Field | Description |
|---|---|
| `workspace_id` | Workspace context (nullable) |
| `environment_id` | Environment context (nullable) |
| `user_id` | Acting user (nullable for system/API key actors) |
| `api_key_id` | Acting API key (nullable) |
| `device_id` | Device subject (nullable) |
| `actor_type` | `user`, `api_key`, or `system` |
| `visibility_scope` | `standard` or `privileged` |
| `action` | Event name (e.g. `auth.login`, `device.command`) |
| `resource_type` | Resource category (nullable) |
| `resource_id` | Resource UUID (nullable) |
| `details` | JSON payload with event-specific data |
| `ip_address` | Client IP at time of event |
| `created_at` | Timestamp |

## Visibility scopes

Audit entries are tagged `standard` or `privileged`. The `privileged` scope is reserved for sensitive internal events (e.g. impersonation, password reset steps). Viewing privileged entries requires `audit.read_privileged` permission, which defaults to the `admin` role minimum.

Standard entries are readable by any workspace member with `audit.read` permission (defaults to `viewer`).

## Sensitive field redaction

Before writing, all `details` values are passed through `sanitizeAuditValue()`, which redacts fields whose keys match the pattern `/(pass(word)?|secret|token|authorization|api[_-]?key|private[_-]?key|totp|otp|activationcode)/i`.

Source: `netlify/functions/_lib/audit.ts`

## API key attribution

When a request is authenticated via API key, the audit entry automatically attributes to the key (`actor_type = 'api_key'`, `api_key_id` populated) and includes the key's name, role, scope, and creating user in `details.auth_context`.

## Where to view

- In-app: environment-scoped audit log view (accessible to members with `audit.read` permission).
- Superadmin UI: workspace-level aggregate view.
- Direct DB query for operators with database access.

## Operational use

- Incident investigation: who did what, when, from which IP.
- Access review: track role changes, user additions/removals.
- Change tracking: policy, group, and configuration changes.
- Billing/compliance evidence: paired with Stripe event logs for billing disputes.

## Retention

Retention policy is operator-controlled. Flash MDM does not enforce a built-in retention period. Operators seeking SOC2 or similar compliance should define and enforce a log retention period and access control for the `audit_log` table.

## Known limitations

- Bulk device operations do not always populate `workspace_id`/`environment_id` in the audit entry.
