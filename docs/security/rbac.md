# RBAC & authorization

Flash MDM implements role-based access control (RBAC) with a configurable permission matrix and minimum permission floors.

## Roles

Role hierarchy (highest to lowest): `owner` > `admin` > `member` > `viewer`

`superadmin` is an operator concept, not a workspace role. Superadmins bypass all RBAC checks.

## Access scopes

Users can be assigned workspace-wide access (`access_scope = 'workspace'`) or scoped access (`access_scope = 'scoped'`). Scoped users are explicitly assigned to specific environments and/or groups within a workspace. Role inheritance flows: group membership → environment membership → workspace membership.

## Default permission matrix

Source: `netlify/functions/_lib/rbac.ts` (`DEFAULT_PERMISSION_MATRIX`).

### `workspace`

- `read` → `viewer`
- `write` → `admin`
- `delete` → `owner`
- `manage_users` → `admin`
- `manage_settings` → `owner`

### `environment`

- `read` → `viewer`
- `write` → `admin`
- `delete` → `owner`
- `manage_users` → `admin`
- `manage_settings` → `admin`

### `group`

- `read` → `viewer`
- `write` → `member`
- `delete` → `admin`
- `manage_users` → `admin`

### `device`

- `read` → `viewer`
- `write` → `member`
- `delete` → `member`
- `command` → `member`
- `command_destructive` → `admin`
- `bulk_destructive` → `admin`

### `policy`

- `read` → `viewer`
- `write` → `member`
- `delete` → `admin`

### `certificate`

- `read` → `viewer`
- `write` → `member`
- `delete` → `admin`

### `geofence`

- `read` → `viewer`
- `write` → `member`
- `delete` → `admin`

### `audit`

- `read` → `viewer`
- `read_privileged` → `admin`

### `invite`

- `read` → `admin`
- `write` → `admin`
- `delete` → `admin`

### `billing`

- `license_view` → `viewer`
- `billing_view` → `admin`
- `billing_manage` → `admin`
- `billing_customer` → `owner`

## Minimum permission floors

Workspaces may override the permission matrix via settings (owner-only action), but minimum floors are enforced at write time and cannot be lowered below safe defaults. For example, `device.command_destructive` cannot be set below `admin`, and `invite.*` cannot be set below `admin`.

Source: `MINIMUM_PERMISSION_FLOORS` in `netlify/functions/_lib/rbac.ts`.

## API key scoping

API keys are issued with a fixed role (`owner`/`admin`/`member`/`viewer`) and a scope type of either `workspace` or `environment`. A workspace-scoped key inherits its role across all environments in that workspace. An environment-scoped key is restricted to the nominated environment.

API keys are never granted `is_superadmin`. The `requireSuperadmin()` guard explicitly rejects API key auth. There are currently no API key scopes that permit access to superadmin endpoints; this may change in future releases.

## Permission matrix caching

The effective permission matrix for each workspace is cached in-memory for 30 seconds to avoid repeated DB reads. Cache is globally cleared (all workspaces) on any matrix update or reset.

## Known limitations

- Workflow DELETE uses the `write` permission check rather than `delete`, inconsistent with other resource types.

## References

- `netlify/functions/_lib/rbac.ts`
- `netlify/functions/_lib/rbac-matrix.ts`
- `netlify/functions/roles-rbac.ts`
- `netlify/functions/workspace-users.ts`
- `docs/reference/endpoints-detailed.md` (best-effort mapping)
