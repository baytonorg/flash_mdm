# Policy System — Implementation Guide

This document describes the complete policy management system in Flash MDM: how policies are authored, assigned, inherited, overridden, generated into per-scope derivatives, and deployed to devices via the Android Management API (AMAPI).

---

## Table of contents

1. [Mental model](#mental-model)
2. [Database schema](#database-schema)
3. [Policy lifecycle](#policy-lifecycle)
4. [Assignment & inheritance](#assignment--inheritance)
5. [Locks](#locks)
6. [Overrides](#overrides)
7. [Derivative generation pipeline](#derivative-generation-pipeline)
8. [Variable substitution](#variable-substitution)
9. [Deployment pipeline](#deployment-pipeline)
10. [RBAC rules](#rbac-rules)
11. [API reference](#api-reference)
12. [Frontend architecture](#frontend-architecture)
13. [File index](#file-index)

---

## Mental model

```
Policy (template)                    "Corporate Standard"
  |-- Base AMAPI JSON                The admin-authored policy configuration
  |-- Shared items                   Apps, WiFi networks, certificates assigned at scope
  |-- Variables                      ${device.sn}, ${user.email}, ${group.department}
  +-- Overrides                      Group/device-level JSON patches that diverge from template
        |
        v
Generated derivatives (per scope)   What actually gets pushed to AMAPI
  |-- Environment derivative         "Corporate Standard" at environment scope
  |-- Group derivatives              "Corporate Standard" for the Sales group (+ Sales apps)
  +-- Device derivatives             "Corporate Standard" for device XYZ (+ variables resolved)
```

A **policy** is a JSON template that maps to the [AMAPI Policy resource](https://developers.google.com/android/management/reference/rest/v1/enterprises.policies). It is never pushed to AMAPI directly. Instead, the system generates **derivatives** — one per scope where the policy is assigned — that incorporate shared items, overrides, and variable substitution. Each derivative becomes a real AMAPI policy resource that devices are pointed at.

---

## Database schema

### `policies`

The core policy table. Each row is a template authored by an admin.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `environment_id` | UUID FK → environments | Owning environment |
| `name` | VARCHAR(255) | Human-readable name |
| `description` | TEXT | Optional description |
| `deployment_scenario` | VARCHAR(20) | `fm` (fully managed), `wp` (work profile), `dedicated` |
| `config` | JSONB | Base AMAPI policy JSON. Deployment-managed fields (`applications`, `openNetworkConfiguration`, `deviceConnectivityManagement`) are stripped on save and regenerated during derivative generation |
| `amapi_name` | VARCHAR(255) | Canonical AMAPI resource name of the environment-scope derivative |
| `version` | INTEGER | Monotonically increasing version counter |
| `status` | VARCHAR(20) | `draft`, `production`, `archived` |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### `policy_versions`

Immutable version history. One row per policy update.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `policy_id` | UUID FK → policies | |
| `version` | INTEGER | Version number at time of save |
| `config` | JSONB | Full config snapshot |
| `changed_by` | UUID FK → users | Who saved it |
| `change_summary` | TEXT | Optional description of what changed |
| `created_at` | TIMESTAMPTZ | |

### `policy_assignments`

Maps a policy to a scope (environment, group, or device). Includes lock fields.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `policy_id` | UUID FK → policies | |
| `scope_type` | VARCHAR(20) | `environment`, `group`, or `device` |
| `scope_id` | UUID | Polymorphic — the ID of the environment, group, or device |
| `locked` | BOOLEAN | When `true`, the entire inherited config is read-only for child scopes |
| `locked_sections` | TEXT[] | Array of top-level AMAPI keys locked (e.g. `['passwordPolicies', 'applications']`) |
| `locked_by` | UUID FK → users | Who set the lock |
| `locked_at` | TIMESTAMPTZ | When the lock was set |
| `created_at` | TIMESTAMPTZ | |

**Unique constraint:** `(policy_id, scope_type, scope_id)`

### `policy_derivatives`

Generated per-scope AMAPI policies. Each row is a compiled output ready for AMAPI.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `policy_id` | UUID FK → policies | Source template |
| `environment_id` | UUID FK → environments | |
| `scope_type` | VARCHAR(20) | `environment`, `group`, or `device` |
| `scope_id` | UUID | Polymorphic scope target |
| `payload_hash` | VARCHAR(64) | SHA-256 of the generated config. Used to skip redundant AMAPI calls |
| `amapi_name` | VARCHAR(255) | The AMAPI policy resource name (e.g. `enterprises/E/policies/pd-abc-device-def-hash`) |
| `config` | JSONB | Full generated AMAPI policy payload |
| `metadata` | JSONB | Generation metadata — what was merged, which overrides applied, locked sections, variables |
| `status` | VARCHAR(20) | `draft` or `production` |
| `last_synced_at` | TIMESTAMPTZ | Last AMAPI PATCH time |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Derivative naming convention:**
```
enterprises/{enterpriseId}/policies/pd-{policyToken}-{scopeType}-{scopeToken}-{hash}
```
Where `policyToken` is the first 12 alphanumeric characters of the policy ID, `scopeToken` is the first 16 of the scope ID, and `hash` is the first 12 characters of SHA-256(`policyId:scopeType:scopeId`).

### `group_policy_overrides`

Sparse JSON overrides at the group level.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `group_id` | UUID FK → groups | |
| `policy_id` | UUID FK → policies | |
| `environment_id` | UUID FK → environments | |
| `override_config` | JSONB | Only the keys being overridden |
| `created_by` | UUID | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Unique constraint:** `(group_id, policy_id)`

### `device_policy_overrides`

Same as group overrides, but at device scope. Merges last (highest priority).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `device_id` | UUID FK → devices | |
| `policy_id` | UUID FK → policies | |
| `environment_id` | UUID FK → environments | |
| `override_config` | JSONB | Only the keys being overridden |
| `created_by` | UUID | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Unique constraint:** `(device_id, policy_id)`

### `deployment_jobs`

Tracks batch deployment operations with progress, cancellation, and rollback.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `environment_id` | UUID FK → environments | |
| `policy_id` | UUID FK → policies | |
| `status` | VARCHAR(20) | `pending`, `running`, `completed`, `failed`, `cancelled`, `rolling_back`, `rolled_back`, `rollback_failed` |
| `total_devices` | INTEGER | Total devices in scope |
| `completed_devices` | INTEGER | Successfully processed |
| `failed_devices` | INTEGER | Failed (errors logged) |
| `skipped_devices` | INTEGER | Skipped (already up-to-date) |
| `created_by` | UUID | |
| `started_at` | TIMESTAMPTZ | |
| `completed_at` | TIMESTAMPTZ | |
| `cancelled_at` | TIMESTAMPTZ | |
| `error_log` | JSONB | Array of `{device_id, error, timestamp}` — last 100 entries |
| `rollback_snapshot` | JSONB | Pre-deployment state: `{scopeId: {payload_hash, amapi_name}}` |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

---

## Policy lifecycle

```
Create (draft) → Edit config → Assign to scope → Generate derivatives → Deploy to devices
                      ↑                                     |
                      +── Override at group/device ──────────+
```

### 1. Create

A new policy is created in `draft` status with version 1. The admin provides a name, description, deployment scenario, and an initial AMAPI config JSON (or starts from an empty template).

### 2. Edit

Editing updates the base `config` column, increments `version`, and inserts a row into `policy_versions`. Deployment-managed fields (`applications`, `openNetworkConfiguration`, `deviceConnectivityManagement`) are stripped from the saved config because they are regenerated from app/network deployments during derivative generation.

When the admin saves with `push_to_amapi = true`:
1. `buildGeneratedPolicyPayload()` generates the AMAPI payload for the policy's target scope
2. The payload is PATCHed to AMAPI using an incremental update mask (only changed fields)
3. `syncPolicyDerivativesForPolicy()` regenerates all derivatives and pushes changes

AMAPI sync failure is **non-blocking** — the policy is saved locally and the error is returned in the response for the admin to address.

### 3. Assign

See [Assignment & inheritance](#assignment--inheritance).

### 4. Generate

See [Derivative generation pipeline](#derivative-generation-pipeline).

### 5. Deploy

See [Deployment pipeline](#deployment-pipeline).

---

## Assignment & inheritance

A policy is assigned to a scope — environment, group, or device — via the `policy_assignments` table. Assignment determines which scopes inherit the policy and generate derivatives from it.

### Effective policy resolution

When determining which policy applies to a device, the system resolves in order of specificity:

1. **Direct device assignment** — `policy_assignments WHERE scope_type = 'device' AND scope_id = {deviceId}`
2. **Group hierarchy** — Walk the `group_closures` table from the device's group upward through ancestors. The nearest ancestor with a policy assignment wins.
3. **Environment assignment** — `policy_assignments WHERE scope_type = 'environment' AND scope_id = {environmentId}`
4. **Legacy fallback** — `devices.policy_id` (backward compatibility; will be removed)

The first match wins. A device always has at most one effective policy.

### Assignment side-effects

When a policy is assigned to a scope:
1. A `policy_assignment` row is created (or updated on conflict)
2. `syncPolicyDerivativesForPolicy()` regenerates derivatives for all affected scopes
3. All affected devices are pointed at their appropriate derivative via AMAPI PATCH on the device resource

When a policy is unassigned:
1. Affected devices are captured **before** the assignment is deleted
2. The assignment row is removed
3. Each affected device is re-resolved to its new effective policy (may fall back to a parent group or environment assignment)

### A child can always assign a different policy

Locks (described below) control whether a child scope can **override the config** of an inherited policy. They do **not** prevent a child scope from assigning a completely different policy. A child group can always point to a different template — locks only govern modifications within the same inherited template.

---

## Locks

Locks prevent child scopes from overriding specific sections (or the entire config) of an inherited policy. They are set at the assignment level and accumulate downward through the group hierarchy.

### Lock types

| Field | Behaviour |
|-------|-----------|
| `locked = true` | Entire policy config is read-only for all child scopes |
| `locked_sections = ['passwordPolicies', 'applications']` | Only the listed top-level AMAPI keys are locked; other sections can still be overridden |

### Lock inheritance

Locks accumulate downward. A grandchild scope inherits locks from both its parent and grandparent. The system walks the `group_closures` table upward and unions all `locked_sections` from every ancestor assignment, plus checks the environment-level assignment.

```
Environment: locked_sections = ['statusReportingSettings']
  └── Group A: locked_sections = ['applications']
        └── Group A.1: (no locks of its own)
              └── Device in A.1
                    → Inherits: fully_locked=false,
                       locked_sections=['statusReportingSettings', 'applications']
                       Cannot override either section.
```

If any ancestor sets `locked = true`, the entire policy is fully locked for all descendants — no overrides permitted at all.

### Lock scope

- **Environment-level locks** apply to all groups and devices in that environment
- **Group-level locks** apply to all descendant groups and devices of that group
- **Device-level locks** are theoretically possible but not currently used in the UI

### Who can set locks

See [RBAC rules](#rbac-rules).

---

## Overrides

Overrides allow a group or device to diverge from the inherited policy template for specific config sections. They are stored as **sparse JSON** — only the keys being changed are stored, not the entire config.

### How overrides work

1. An admin opens the override editor for a group or device
2. They see each top-level AMAPI config section with its inherited value
3. Locked sections are shown with a lock icon and cannot be toggled
4. Unlocked sections can be toggled to "Override" mode, enabling editing
5. The override is saved as a sparse JSON object (e.g. `{"passwordPolicies": {...}}`)
6. Saving triggers derivative regeneration — the override is deep-merged into the generated payload

### Override merge order

Overrides are applied during derivative generation in this order:

```
1. Base policy config
2. + App deployments (environment → group hierarchy → device)
3. + Network deployments (environment → group hierarchy → device)
4. + Group overrides (ancestor → descendant order; descendant wins)
5. + Device overrides (highest priority — merges last)
6. + Variable substitution (device-scoped values interpolated)
```

At each override layer, locked sections from ancestor assignments are **excluded** — they pass through untouched from the locking scope.

### Resetting overrides

"Reset to inherited" removes the override for a scope entirely (deletes the `group_policy_overrides` or `device_policy_overrides` row). The derivative is regenerated using only the inherited values.

---

## Derivative generation pipeline

The derivative pipeline transforms a policy template + shared items + overrides + variables into a complete AMAPI policy payload for each scope where the policy is assigned.

### `buildGeneratedPolicyPayload()`

Located in `policy-generation.ts`. This is the core generation function.

**Inputs:**
- Policy ID and base config
- Environment ID and AMAPI context (enterprise, project)
- Target scope (environment, group, or device)

**Steps:**
1. Clone the base policy config
2. Resolve the generation target (auto-detect from assignments, or explicit scope)
3. Load and merge **app deployments** — queries `app_deployments` at environment, group hierarchy, and device scopes. Builds the `applications` array.
4. Load and merge **network deployments** — queries `network_deployments` for WiFi (ONC) and APN configs. Builds `openNetworkConfiguration` and `deviceConnectivityManagement`.
5. Load and merge **group overrides** — queries `group_policy_overrides` joined with `group_closures`, ordered ancestor-first (deepest ancestor → self). Each override is deep-merged in order, skipping locked sections.
6. Load and merge **device overrides** — queries `device_policy_overrides` for the target device. Deep-merged last, skipping locked sections.
7. Detect **device-scoped variables** — scans the final payload for `${namespace.key}` tokens. If found at a non-device scope, flags that per-device derivatives are needed.
8. Return the payload and generation metadata.

**Output:**
```typescript
{
  payload: Record<string, unknown>,  // Complete AMAPI policy JSON
  metadata: {
    model: 'layered_overrides',
    assignments_considered: [...],
    resolved_target: { scope_type, scope_id },
    device_scoped_variables: ['device.sn', 'user.email'],
    requires_per_device_derivative: true,
    group_overrides_applied: [{ group_id, group_name, keys: ['passwordPolicies'] }],
    device_overrides_applied: ['wifiConfigurations'],
    locked_sections: ['applications'],
  }
}
```

### `syncPolicyDerivativesForPolicy()`

Located in `policy-derivatives.ts`. Orchestrates the full sync across all scopes.

**Flow:**
1. Find all `policy_assignments` for this policy
2. For each assigned scope, call `buildGeneratedPolicyPayload()`
3. Hash the payload — if the hash matches the existing derivative, skip the AMAPI call
4. If changed: upsert the `policy_derivatives` row and PATCH the AMAPI policy resource
5. If the payload contains device-scoped variables at a non-device scope, create individual device derivatives for every device in that scope
6. Batch all DB upserts into a single transaction

**Hash-based skip:** Each derivative stores a `payload_hash` (SHA-256 of the generated config). If the hash hasn't changed since the last sync, the AMAPI PATCH is skipped entirely. This avoids unnecessary API calls when overrides or shared items haven't actually changed the output.

**AMAPI update mask:** Rather than replacing the entire policy resource, the system computes a field-level update mask by comparing old and new configs. Only changed top-level fields are included in the PATCH request, reducing the risk of unintended overwrites.

### When derivatives are regenerated

Derivatives are regenerated automatically when:
- A policy's base config is updated (with `push_to_amapi = true`)
- A policy is assigned or unassigned at any scope
- An override is saved or reset
- An app or network deployment is created, updated, or removed
- A deployment job is triggered

---

## Variable substitution

Policies can contain `${namespace.key}` tokens in string values. These are resolved to actual device/user/group/environment attributes when generating device-scoped derivatives.

### Supported namespaces and keys

Variables are strict namespaces and are case-insensitive during lookup:

- `device.*`
  - Required/common: `${device.name}`, `${device.sn}`, `${device.serial_number}`, `${device.imei}`, `${device.model}`, `${device.manufacturer}`
  - Assigned user shortcuts: `${device.assigneduserfirstname}`, `${device.assigneduserlastname}`, `${device.assigneduseremail}`, `${device.assigneduserrole}`, `${device.assignedusergroup}`
  - Additional useful fields: `${device.os_version}`, `${device.security_patch_level}`, `${device.state}`, `${device.ownership}`, `${device.management_mode}`, `${device.policy_compliant}`, `${device.last_status_report_at}`
- `user.*`
  - `${user.firstname}`, `${user.lastname}`, `${user.email}`, `${user.role}`, `${user.group}`, `${user.name}`
- `group.*`
  - `${group.id}`, `${group.name}`, `${group.description}`
  - `${group.<metadata_key>}` from group settings metadata (for example `${group.region}`)
- `environment.*`
  - `${environment.id}`, `${environment.workspace_id}`, `${environment.name}`, `${environment.enterprise_name}`, `${environment.enterprise_display_name}`

### Resolution behaviour

- Variables are detected during `buildGeneratedPolicyPayload()` by scanning all string values for `${...}` patterns
- Only `${...}` syntax is recognized; legacy `$var` and `var$` patterns are ignored
- If variables are found in a policy assigned at environment or group scope, the system creates **individual device derivatives** for each device in that scope (because each device needs different variable values)
- During device derivative generation, `resolveVariables()` recursively walks the JSON tree and substitutes tokens with values from `buildVariableContextForDevice()`
- Unresolved variables (no matching value) are left as-is in the output and logged as warnings in the derivative metadata
- Variable resolution is case-insensitive

### Example

Policy config:
```json
{
  "wifiConfigurations": [{
    "ssid": "${group.name}-secure",
    "identity": "${user.email}"
  }]
}
```

For a device in the "Sales" group with user email "alice@corp.com":
```json
{
  "wifiConfigurations": [{
    "ssid": "Sales-secure",
    "identity": "alice@corp.com"
  }]
}
```

---

## Deployment pipeline

The deployment pipeline handles batch-pushing policy changes to devices with progress tracking, cancellation, and rollback.

### How it works

1. **Queue** — Admin triggers a deployment for a policy. The system:
   - Finds all devices affected by this policy (across all assigned scopes)
   - Captures a **rollback snapshot** of each device's current derivative state (`payload_hash`, `amapi_name`)
   - Creates a `deployment_jobs` row with status `pending`
   - Returns the job ID immediately

2. **Process** — The job starts processing asynchronously:
   - Status transitions to `running`
   - Calls `syncPolicyDerivativesForPolicy()` to regenerate all derivatives
   - Iterates through devices in batches, calling `assignPolicyToDeviceWithDerivative()` for each
   - After each batch, updates `completed_devices`, `failed_devices`, `skipped_devices`
   - Checks for cancellation between batches

3. **Complete** — When all devices are processed:
   - Status transitions to `completed` (or `failed` if errors occurred)
   - `completed_at` timestamp is set

### Rate limiting

AMAPI enforces a quota of approximately 60 requests per minute per enterprise. The deployment pipeline uses conservative batching:

| Setting | Value | Effect |
|---------|-------|--------|
| `BATCH_SIZE` | 10 devices | Process 10 devices per batch |
| `BATCH_DELAY_MS` | 2000 ms | Wait 2 seconds between batches |
| **Effective rate** | ~30 req/min | Safely under the 60 req/min AMAPI quota |

### Cancellation

An admin can cancel a running deployment. Between batches, the job checks its status in the database. If cancelled:
- Status transitions to `cancelled`
- Remaining devices are not processed
- Already-processed devices keep their new derivative

### Rollback

After a deployment completes (or fails), an admin can trigger a rollback:
1. Status transitions to `rolling_back`
2. The system re-syncs all derivatives from the current base config
3. Status transitions to `rolled_back`

Note: Rollback regenerates derivatives from the current policy state, which effectively reverses the deployment if the policy hasn't been modified since.

### Error handling

- Individual device failures are non-fatal — the job continues with remaining devices
- Errors are logged in the `error_log` JSONB array (last 100 entries retained)
- Each error entry includes `device_id`, `error` message, and `timestamp`

---

## RBAC rules

The policy system enforces role-based access control at multiple levels. The role hierarchy is:

```
superadmin > owner (100) > admin (75) > member (50) > viewer (25)
```

### Policy CRUD

| Action | Minimum role |
|--------|-------------|
| View policies | `viewer` (environment level) |
| Create/edit policies | `member` (environment level) |
| Delete policies | `admin` (environment level) |

### Policy assignment

| Scope | Who can assign |
|-------|---------------|
| Environment | Environment admin or higher |
| Group | Environment admin, or group admin within their subtree |
| Device | Environment admin, or group admin of the device's group |

### Lock modification

| Role | Can set/remove locks? |
|------|----------------------|
| Superadmin | Yes — anywhere |
| Environment admin | Yes — at any scope within the environment |
| Group admin | Yes — within their subtree only. Cannot modify locks set by ancestor scopes |
| Member / Viewer | No |

**Lock preservation on reassignment:** When a group admin (non-environment-admin) reassigns a policy at their scope, existing locks set by ancestors are preserved. The admin cannot clear or modify locks they don't have permission to change — the system queries the existing assignment's lock state and carries it forward.

### Override modification

| Role | Can override locked sections? | Can override unlocked sections? |
|------|------------------------------|--------------------------------|
| Superadmin | Yes | Yes |
| Environment admin | Yes | Yes |
| Group admin | No — rejected with 403 | Yes — within their subtree |
| Member | No | Yes — within their scope |
| Viewer | No | No |

### Deployment jobs

| Action | Minimum role |
|--------|-------------|
| Create deployment | `admin` (environment level) |
| Cancel deployment | `admin` (environment level) |
| Trigger rollback | `admin` (environment level) |
| View deployment status | `viewer` (environment level) |

---

## API reference

### Policy CRUD

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/policies/list?environment_id=...` | List all policies in environment |
| `GET` | `/api/policies/external?environment_id=...` | List AMAPI policies with local sync status |
| `GET` | `/api/policies/{id}` | Get single policy with components |
| `GET` | `/api/policies/derivatives?policy_id=...&environment_id=...` | List derivatives for a policy |
| `POST` | `/api/policies/create` | Create new policy |
| `PUT` | `/api/policies/update` | Update policy config |
| `DELETE` | `/api/policies/{id}?environment_id=...` | Delete policy |

### Policy assignment

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/policies/assign` | Assign policy to scope (with optional locks) |
| `POST` | `/api/policies/unassign` | Remove policy assignment |
| `GET` | `/api/policies/assignments?environment_id=...` | List all assignments |
| `GET` | `/api/policies/effective?device_id=...` | Resolve effective policy for a device |

### Overrides

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/policies/overrides?policy_id=...&scope_type=...&scope_id=...` | Get override config + lock state |
| `GET` | `/api/policies/overrides/locks?policy_id=...&scope_type=...&scope_id=...` | Get inherited lock state only |
| `PUT` | `/api/policies/overrides` | Save override config |
| `DELETE` | `/api/policies/overrides?policy_id=...&scope_type=...&scope_id=...` | Reset overrides |

### Cloning & versions

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/policies/clone` | Clone a policy |
| `GET` | `/api/policies/versions?policy_id=...` | List version history |
| `GET` | `/api/policies/versions?policy_id=...&version=...` | Get specific version config |

### Deployments

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/deployments` | Create deployment job |
| `GET` | `/api/deployments?id=...` | Get single job status |
| `GET` | `/api/deployments?environment_id=...` | List jobs for environment |
| `POST` | `/api/deployments?action=cancel` | Cancel running job |
| `POST` | `/api/deployments?action=rollback` | Rollback completed/failed job |

---

## Frontend architecture

### Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/policies` | `Policies.tsx` | Policy list with filters (status, scenario, search), device counts, and row actions (edit, clone, delete) |
| `/policies/new` | `PolicyEditor.tsx` | Create mode — name, description, scenario, initial config |
| `/policies/:id` | `PolicyEditor.tsx` | Edit mode — form editor with category navigation, JSON editor, version history, derivatives panel |

### Key components

| Component | Location | Purpose |
|-----------|----------|---------|
| `PolicyOverrideEditor` | `src/components/policy/PolicyOverrideEditor.tsx` | Toggle-to-override UX for group and device scopes. Shows inherited values, lock indicators, and per-section override toggles. Used in both group detail and device detail pages. |
| `PolicyDerivativesPanel` | `src/components/policy/PolicyDerivativesPanel.tsx` | Assignment map showing all scopes with lock status and override counts. Derivative list with sync status, payload hashes, and device counts. Deployment progress integration. |
| `DeploymentProgress` | `src/components/deployment/DeploymentProgress.tsx` | Real-time deployment progress bar with completed/failed/skipped counts. Cancel and rollback buttons. Collapsible error log. |

### React Query hooks

**`src/api/queries/policies.ts`**
- `usePolicies(envId)` — list policies
- `usePolicy(id)` — single policy
- `useCreatePolicy()` / `useUpdatePolicy()` / `useDeletePolicy()` — mutations
- `usePolicyAssignments(envId)` — all assignments
- `useClonePolicy()` — clone mutation
- `usePolicyVersions(policyId)` / `usePolicyVersion(policyId, version)` — version history

**`src/api/queries/policy-overrides.ts`**
- `usePolicyOverride(policyId, scopeType, scopeId)` — fetch overrides + lock state
- `useInheritedLocks(policyId, scopeType, scopeId)` — lock state only
- `useSavePolicyOverride()` / `useResetPolicyOverride()` — mutations

**`src/api/queries/deployments.ts`**
- `useDeploymentJob(jobId)` — single job with auto-polling (every 2s while active)
- `useDeploymentJobs(envId)` — list jobs
- `useCreateDeployment()` / `useCancelDeployment()` / `useRollbackDeployment()` — mutations

---

## File index

### Backend — Netlify Functions

| File | Purpose |
|------|---------|
| `netlify/functions/policy-crud.ts` | Policy CRUD operations, AMAPI sync |
| `netlify/functions/policy-assign.ts` | Assignment, unassignment, effective policy resolution, lock RBAC |
| `netlify/functions/policy-overrides.ts` | Override CRUD with lock validation |
| `netlify/functions/policy-clone.ts` | Policy duplication |
| `netlify/functions/policy-versions.ts` | Version history retrieval |
| `netlify/functions/deployment-jobs.ts` | Deployment pipeline with progress, cancel, rollback |

### Backend — Shared libraries

| File | Purpose |
|------|---------|
| `netlify/functions/_lib/policy-generation.ts` | `buildGeneratedPolicyPayload()` — the core generation pipeline |
| `netlify/functions/_lib/policy-derivatives.ts` | Derivative sync, device assignment, AMAPI context |
| `netlify/functions/_lib/policy-locks.ts` | Lock inheritance, `canModifyLocks()`, `canSaveOverrides()`, `validateOverrideAgainstLocks()` |
| `netlify/functions/_lib/variable-resolution.ts` | `resolveVariables()`, `buildVariableContextForDevice()` |
| `netlify/functions/_lib/policy-recompile.ts` | Legacy component recompilation (backward compat) |
| `netlify/functions/_lib/policy-update-mask.ts` | AMAPI incremental update mask computation |

### Frontend

| File | Purpose |
|------|---------|
| `src/pages/Policies.tsx` | Policy list page |
| `src/pages/PolicyEditor.tsx` | Policy create/edit page |
| `src/components/policy/PolicyOverrideEditor.tsx` | Override toggle UX |
| `src/components/policy/PolicyDerivativesPanel.tsx` | Derivatives + assignment map + deployment |
| `src/components/deployment/DeploymentProgress.tsx` | Real-time deployment progress |
| `src/api/queries/policies.ts` | Policy React Query hooks |
| `src/api/queries/policy-overrides.ts` | Override React Query hooks |
| `src/api/queries/deployments.ts` | Deployment React Query hooks |

### Database

| Tables | Purpose |
|--------|---------|
| `policies`, `policy_versions`, `policy_assignments`, `policy_derivatives` | Core policy storage, versioning, assignment, and derivative generation |
| `policy_components`, `policy_component_assignments` | Reusable config fragments and their assignment to policies |
| `group_policy_overrides`, `device_policy_overrides` | Sparse JSON overrides at group/device scope, with lock columns on `policy_assignments` |
| `deployment_jobs` | Batched policy deployment tracking |

All tables are defined in `netlify/functions/migrate.ts` (migrations are inlined for esbuild bundling). SQL sources live in `netlify/migrations/` for reference.

### Routing

All policy routes are configured in `netlify.toml`. Specific routes (e.g. `/api/policies/assign`) are listed before the catch-all `/api/policies/*` to ensure correct matching.
