# Policy Derivative Stack (AMAPI Policy Generation)

This document explains how Flash MDM currently builds and assigns AMAPI policies using a layered local policy model plus generated derivatives.

It is intended as the maintenance reference for future work on the derivative stack.

## Why this exists

We do **not** want to clone local policies per device.

Instead, we keep:

- one local policy definition (`policies`)
- scoped policy assignment (`policy_assignments`)
- scoped app/network deployments (`app_deployments`, `network_deployments`)
- generated AMAPI policy derivatives (`policy_derivatives`)

The effective policy for a device is computed from scope precedence:

1. device
2. group
3. environment

This lets us support inheritance plus visible overrides, while still producing concrete AMAPI policies for enrolment/device assignment.

## Core concepts

### Local policy (source of truth)

- Table: `policies`
- Contains the base policy config JSON and metadata.
- This is the authoring object shown in the UI.

### Scoped assignments

- Table: `policy_assignments`
- Assigns one local policy to a scope (`environment`, `group`, `device`).
- A device resolves the winning local policy from:
  - device assignment
  - else nearest group assignment
  - else environment assignment
  - else legacy `devices.policy_id` fallback

### Scoped overlays (apps/networks)

- Tables:
  - `app_deployments`
  - `network_deployments`
- These are not separate local policies.
- They are layered into the generated AMAPI payload at generation time.

### Generated derivative

- Table: `policy_derivatives` (see `migrate.ts`)
- One row per local `policy_id + scope_type + scope_id`
- Stores:
  - generated payload (`config`)
  - payload hash (`payload_hash`)
  - AMAPI policy resource name (`amapi_name`)
  - generation metadata (`metadata`)

This is the “derivative stack” foundation.

## Precedence and merge model

The policy generator builds the AMAPI payload from:

1. base local policy config (`policies.config`)
2. env app deployments
3. group app deployments (ancestor to descendant precedence)
4. device app deployments
5. env network deployments
6. group network deployments (ancestor to descendant precedence)
7. device network deployments

Notes:

- Apps and networks use upsert semantics (same package / same network identity is replaced by lower scope).
- The generator currently preserves existing AMAPI payload structures used by deploy functions (`applications`, `openNetworkConfiguration`, `deviceConnectivityManagement.apnPolicy`).

## Device-scoped variable exception

The generator detects namespaced variables in the payload using `${namespace.key}` syntax (e.g. `${device.name}`, `${user.email}`, `${group.region}`).

When detected:

- generation metadata sets `requires_per_device_derivative = true`
- derivative sync creates individual device derivatives for all devices in the affected scope

Variable interpolation is implemented in `netlify/functions/_lib/variable-resolution.ts`. During device derivative generation, `resolveVariables()` substitutes tokens with real values from `buildVariableContextForDevice()`. Unresolved variables are left as-is and logged as warnings in derivative metadata.

## Main code paths

### Layered payload generation

- `netlify/functions/_lib/policy-generation.ts`

Responsibilities:

- build generated payload from local base config + scoped app/network overlays
- choose generation target scope
- detect device-scoped variables
- return metadata for debugging / future orchestration

### Derivative persistence and AMAPI sync

- `netlify/functions/_lib/policy-derivatives.ts`

Responsibilities:

- generate and sync one derivative for a specific scope
- sync all direct assignment contexts for a policy
- force device derivatives when device-scoped variables are detected
- patch AMAPI device `policyName` using the correct device derivative

## Data model (derivatives)

`policy_derivatives` fields (high level):

- `policy_id`
- `environment_id`
- `scope_type`
- `scope_id`
- `payload_hash`
- `amapi_name`
- `config`
- `metadata`
- `status`
- `last_synced_at`

Constraints:

- unique on `(policy_id, scope_type, scope_id)`
- indexed by `policy_id`, scope, env, hash
- optional unique index on `amapi_name`

## When derivatives are generated/synced

Derivatives are synced after AMAPI policy updates in these flows:

- policy save (`/api/policies/update`)
- component recompile (`recompilePolicy`)
- app deployment (`/api/apps/deploy`)
- network deployment (`/api/networks/deploy`)

This ensures “save after deploy” still pushes the correct effective policy to AMAPI.

## AMAPI assignment behavior (current)

### Enrollment tokens

`/api/enrolment/create` now sets `policyName` to a derivative:

- group derivative if `group_id` is provided
- otherwise environment derivative

This means enrolled devices start on a scope-correct AMAPI policy immediately.

### Device assignment

These flows now patch AMAPI device `policyName` using a **device derivative**:

- `/api/policies/assign` when `scope_type = device`
- enrollment sync (`sync-process-background`) when a token policy is applied to a newly enrolled device
- workflow action `device.assign_policy`

This is the path that enforces the strongest precedence at the actual device.

## Canonical vs derivative AMAPI name

`policies.amapi_name` is still kept for backward compatibility and external references.

Current rule:

- if an environment derivative exists, its `amapi_name` is the preferred canonical AMAPI name for the local policy

Derivatives are the more precise source for scope/device AMAPI policy resources.

## External policy viewer behavior

`/api/policies/external` now resolves local policy matches against:

- `policies.amapi_name`
- `policy_derivatives.amapi_name`

There is a fallback query if `policy_derivatives` does not exist yet (pre-migration environment).

## Error handling / safety behavior

- Local saves/deployments still persist even if AMAPI sync fails (existing behavior preserved where possible).
- Device assignment APIs may return local success with AMAPI device sync failure details.
- Enrollment sync AMAPI derivative assignment is best-effort and logs warnings on failure.

## Current limitations (important)

1. No derivative garbage collection yet

- If assignments/scopes are removed, old derivative rows and AMAPI policy resources are not cleaned up automatically.

2. No cross-scope AMAPI dedupe by payload hash

- `payload_hash` is stored and used to skip re-patching the same derivative row.
- We do not yet reuse one AMAPI policy across multiple derivative scopes that hash to identical payloads.

3. No global “reassign all affected devices” reconciler yet

- We now patch several assignment entry points.
- A dedicated reconcile job for all devices after derivative changes would improve consistency.

## How to extend the derivative stack safely

### If adding a new scoped overlay type (e.g. certificates, restrictions, scripts)

1. Add storage table for deployments/overrides
2. Add overlay application logic in `policy-generation.ts`
3. Define merge semantics explicitly:
   - replace
   - merge
   - remove/tombstone
4. Trigger `syncPolicyDerivativesForPolicy(...)` from the write path

### If extending variable interpolation

Variable interpolation is implemented in `_lib/variable-resolution.ts`. To add new variables:

1. Add the namespaced key and resolver source to `buildVariableContextForDevice()`
2. Update the `VariableContext` type if adding a new context category
3. Ensure device derivatives are recomputed when the source attribute changes (device attribute updates, group moves, user binding changes)
4. Document the new variable in `policies_implementation.md` and `policy_readme.md`

### If adding cross-scope AMAPI dedupe

Use `payload_hash` as the starting key, but track references:

- one AMAPI policy resource may be referenced by multiple derivative rows
- add ref-count / shared resource table before deleting any AMAPI policy

### If adding cleanup / GC

Add a job that:

- finds stale derivative rows (scope no longer exists / policy unassigned / device deleted)
- unassigns devices if needed
- deletes AMAPI policies only when no derivative references remain

## Practical debugging checklist

When a device has the wrong AMAPI policy:

1. Confirm local winning policy (`/api/policies/effective`)
2. Check `policy_derivatives` row for that `policy_id + device/group/env scope`
3. Check derivative `payload_hash`, `config`, and `amapi_name`
4. Check device snapshot `appliedPolicyName`
5. Verify the triggering write path ran derivative sync (save/deploy/recompile/assignment)

## Recommended next improvements

- Add tests for:
  - enrollment-create derivative selection (env vs group)
  - policy-assign device AMAPI patch path
  - workflow `device.assign_policy` derivative patch path
  - per-device derivative generation when device variables are present
- Add derivative cleanup job
- Add explicit removal/tombstone semantics for overlays
- Trigger device derivative recompute on device attribute changes, group moves, and user binding changes (so variable-substituted derivatives stay current)
