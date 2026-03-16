# Tenancy model & isolation boundaries

Flash MDM is **multi-tenant**.

This page describes the tenancy model and (critically) where isolation is enforced.

## 1) Tenancy primitives

- **Workspace**
  - Top-level tenant container.
  - Contains users (via memberships), environments, and workspace-scoped configuration.

- **Environment**
  - Subdivision within a workspace.
  - Typically maps to an AMAPI enterprise binding.
  - Most operational resources (devices/policies/groups/etc.) are environment-scoped.

- **Group**
  - Hierarchical structure inside an environment.
  - Used for policy assignment and scoping.

- **User**
  - Belongs to a single “home” workspace.
  - Gains access to workspaces via memberships.

- **Membership**
  - `workspace_memberships` provides role + access scope.
  - `environment_memberships` and `group_memberships` provide scoped assignments.

## 2) Access scope

Flash MDM supports two access scopes:

- **Workspace scope**: user can access the whole workspace (subject to RBAC role).
- **Scoped access**: user’s visibility is limited to specific environments/groups they are assigned to.

### Scoped RBAC in practice

A scoped user (access_scope = `’scoped’`) can only see and manage resources within their assigned environments. Key behaviours:

- **Environment listing**: scoped users see only their assigned environments — the environment-crud handler filters by `environment_memberships` rather than returning all workspace environments.
- **User listing**: scoped users see only users who share at least one of their environments, not the full workspace roster. The `workspace-users` handler computes this limited view when the caller lacks workspace-level `read` permission.
- **User management**: a scoped user with an environment-level `owner` or `admin` role can invite and manage users within that environment. The `acting_environment_id` parameter scopes management operations to a specific environment.
- **Settings access**: environment-level settings (e.g. enterprise binding, enrollment config) are gated by the user’s environment role, not their workspace role.
- **Signup links**: environment-scoped signup links force `default_access_scope = ‘scoped’`, ensuring new users inherit scoped access.
- **Customer setup exception**: when a scoped `setup` user creates their first environment, they are automatically promoted to a scoped `owner` of that environment.

### Role hierarchy

Roles are ordered: `owner` > `admin` > `member` > `viewer`. Both workspace-level and environment-level roles use this hierarchy. The RBAC matrix (`_lib/rbac-matrix.ts`) defines permission thresholds per resource and action.

Example implementation:

- `netlify/functions/workspace-users.ts` computes a limited view when the caller lacks permissions to view the full workspace user list.
- `netlify/functions/api-key-crud.ts` rejects API key creation when the requested role exceeds the creator’s role.
- `src/pages/Settings.tsx` constrains the role picker dropdown to roles at or below the caller’s effective role.

## 3) Isolation expectations (what must always be true)

- A request scoped to **Workspace A** must not read/write resources owned by **Workspace B**.
- Environment-scoped resources must be validated against the **environment/workspace** boundary.
- API keys must be scoped and role-capped.
- Superadmin/operator endpoints must be protected and auditable.

## 4) Where enforcement happens (as-built)

### Authentication

- Most API handlers call `requireAuth(request)`.

### Authorization (RBAC)

- Environment-scoped checks:
  - `requireEnvironmentPermission(auth, environmentId, <action>)`

- Workspace/resource checks:
  - `requireWorkspaceResourcePermission(auth, workspaceId, <resource>, <action>)`

A quick starting point for locating these checks:

- `docs/reference/endpoints-detailed.md`

### Database scoping

Even with RBAC checks, many handlers also enforce scoping at the SQL level by joining on `workspace_id` / `environment_id`.

This is important because:

- it reduces the blast radius of logic mistakes
- it makes isolation properties easier to audit

## 5) Common failure modes to guard against

- Accepting an `environment_id` without checking it belongs to the active/allowed workspace.
- Using a resource ID (group/device/etc.) from one environment with another environment context.
- Accidentally exposing privileged listings (e.g. workspace user lists) to scoped users.

## References

- `netlify/functions/_lib/rbac.ts`
- `netlify/functions/_lib/auth.ts`
- `netlify/functions/workspace-users.ts`
- `docs/reference/endpoints-detailed.md`
