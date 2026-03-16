# `netlify/functions/_lib/policy-derivatives.ts`

> Manages the creation, synchronization, and selection of per-scope AMAPI policy derivatives (environment, group, device) including device-specific variable resolution and AMAPI patch orchestration.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DeviceRow` | `type` | Device record with `id` and `amapi_name` |
| `PolicyAmapiContext` | `type` | Context needed for AMAPI calls: `workspace_id`, `gcp_project_id`, `enterprise_name` |
| `SyncedDerivative` | `type` | Result of syncing a single derivative: scope info, AMAPI name, payload hash, metadata, and sync status flags |
| `PreferredDerivativeReasonCode` | `type` | Union of string literals explaining why a derivative was selected |
| `PreferredDerivativeDecision` | `type` | Full decision record: chosen derivative, source scope, reason code, and whether a device derivative was required/redundant |
| `PolicyDerivativeSyncSummary` | `type` | Summary of a full policy sync: all derivatives, preferred AMAPI name, forced device derivative count, warnings |
| `decidePreferredDerivativeSelection` | `(input: DerivativeDecisionInput) => { selected: 'source' \| 'device'; ... }` | Pure decision logic for choosing between source-scope and device-scope derivatives |
| `chooseDerivativeCandidateForDeviceAssignment` | `(input: { sourceScope, environmentId, deviceId, deviceGroupId, candidates }) => DeviceAssignmentDerivativeCandidate \| null` | Picks the best existing derivative candidate to assign a device to |
| `getPolicyAmapiContext` | `(environmentId: string) => Promise<PolicyAmapiContext \| null>` | Loads AMAPI context (workspace, GCP project, enterprise) for an environment |
| `syncPolicyDerivativesForPolicy` | `(input: { policyId, environmentId, baseConfig, amapiContext }) => Promise<PolicyDerivativeSyncSummary>` | Full sync: generates and patches all derivatives for a policy across all assigned scopes |
| `ensurePolicyDerivativeForScope` | `(input: { policyId, environmentId, scopeType, scopeId, ... }) => Promise<SyncedDerivative>` | Ensures a single derivative exists for a specific scope, creating/updating via AMAPI if needed |
| `assignPolicyToDeviceWithDerivative` | `(input: { policyId, environmentId, deviceId, ... }) => Promise<{ policy_name, derivative }>` | Assigns a device to the correct derivative policy via AMAPI PATCH on the device resource |
| `ensurePreferredDerivativeForDevicePolicy` | `(input: { policyId, environmentId, deviceId, ... }) => Promise<PreferredDerivativeDecision>` | Resolves and ensures the preferred derivative for a specific device, handling per-device derivative generation when needed |
| `listAffectedDevicesForPolicyContext` | `(policyId, environmentId, scopeType, scopeId) => Promise<DeviceRow[]>` | Lists devices affected by a policy at a given scope, using effective policy resolution with COALESCE priority |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `listDirectDerivativeContexts` | 608-626 | Queries `policy_assignments` to get unique scope contexts for derivative generation |
| `syncPolicyDerivativeForScope` | 639-795 | Core sync logic: builds payload, resolves device variables, computes hash, skips or patches AMAPI, queues DB upsert |
| `upsertDerivativeRow` | 797-832 | Inserts or updates a `policy_derivatives` row with ON CONFLICT upsert |
| `maybeUpdatePolicyCanonicalAmapiName` | 834-851 | Updates `policies.amapi_name` when the environment-scoped derivative is synced |
| `pickPreferredDerivative` | 853-860 | Selects the preferred derivative from a list, preferring environment > group > first |
| `resolveEffectivePolicySourceForDevice` | 862-914 | Walks device > group (via closure table) > environment assignments to find the effective policy source for a device |
| `buildDerivativeResourceId` | 995-1000 | Generates a deterministic AMAPI resource ID from policy/scope identifiers with SHA-256 hash suffix |
| `hashPayload` | 1002-1004 | SHA-256 hash of JSON-serialized payload for change detection |
| `normalizeJsonObject` | 1006-1021 | Safely parses a value that may be a JSON string or object into a `Record<string, unknown>` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `amapiCall` | `_lib/amapi.js` | Making PATCH calls to Android Management API |
| `assertValidAmapiPolicyPayload` | `_lib/amapi-policy-validation.js` | Validating policy payloads before AMAPI submission |
| `execute`, `query`, `queryOne`, `transaction` | `_lib/db.js` | Database operations and transactional batch writes |
| `buildGeneratedPolicyPayload`, `computePolicyGenerationHash`, `PolicyGenerationMetadata`, `PolicyScopeType` | `_lib/policy-generation.js` | Generating merged policy payloads and computing generation hashes |
| `buildPolicyUpdateMask` | `_lib/policy-update-mask.js` | Computing AMAPI update masks for partial PATCH requests |
| `resolveVariables`, `buildVariableContextForDevice` | `_lib/variable-resolution.js` | Resolving `${namespace.key}` placeholders in device-scoped derivatives |

## Key Logic

The derivative system creates per-scope AMAPI policy resources so that different devices can receive different policy configurations based on their assignment context (environment, group, or device).

**Sync flow (`syncPolicyDerivativesForPolicy`):**
1. Lists all direct assignment contexts for a policy (environment, group, device scopes).
2. For each scope, generates the merged policy payload via `buildGeneratedPolicyPayload`, resolves device variables if applicable, and computes a SHA-256 payload hash.
3. If the payload hash matches the existing derivative, the AMAPI PATCH is skipped (no-op optimization). Otherwise, an update mask is computed and the AMAPI policy is patched.
4. If a scope's metadata indicates `requires_per_device_derivative` (due to device-scoped variables), per-device derivatives are also generated for all affected devices.
5. All DB writes are batched into a single transaction for atomicity (Phase 2).

**Device assignment flow (`assignPolicyToDeviceWithDerivative`):**
1. Resolves the preferred derivative for the device via `ensurePreferredDerivativeForDevicePolicy`.
2. Uses generation hash comparison to detect no-op scenarios and skip the AMAPI device PATCH when possible.
3. Patches the device's `policyName` field via AMAPI and records the sync timestamp.

**Derivative selection (`decidePreferredDerivativeSelection`):**
- Device-scoped assignments always use the source derivative directly.
- Group/environment scopes use the source derivative unless per-device derivatives are required (due to variables or payload differences).
- A redundancy guard collapses device derivatives back to the source when payload hashes match.
