# `netlify/functions/_lib/policy-recompile.ts`

> Recompiles a policy from its assigned component fragments, stores a versioned snapshot, and best-effort syncs the result to AMAPI and derivative scopes.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `deepMerge` | `(target: Record<string, any>, source: Record<string, any>) => Record<string, any>` | Recursively deep-merges two objects; source wins on conflicts; arrays are replaced, not concatenated |
| `sanitizeConfig` | `(obj: unknown) => unknown` | Recursively strips `null`, `undefined`, empty objects, and empty arrays from a config tree |
| `recompilePolicy` | `(policyId: string, userId: string) => Promise<void>` | Main entry point: recompiles a policy from components and syncs to AMAPI |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute`, `query`, `queryOne`, `transaction` | `_lib/db.js` | Database operations and transactional policy update |
| `storeBlob` | `_lib/blobs.js` | Storing versioned policy artifact snapshots |
| `amapiCall` | `_lib/amapi.js` | Patching the policy in Android Management API |
| `assertValidAmapiPolicyPayload` | `_lib/amapi-policy-validation.js` | Validating payload before AMAPI submission |
| `buildPolicyUpdateMask` | `_lib/policy-update-mask.js` | Computing partial update masks for AMAPI PATCH |
| `buildGeneratedPolicyPayload` | `_lib/policy-generation.js` | Generating full payload with app/network deployments for AMAPI sync |
| `syncPolicyDerivativesForPolicy` | `_lib/policy-derivatives.js` | Syncing all derivative scopes after recompilation |

## Key Logic

Recompilation rebuilds a policy's config from its component building blocks:

1. **Component assembly**: Fetches all `policy_component_assignments` ordered by priority (ascending). Each component's `config_fragment` is deep-merged in order, so higher-priority components override lower ones.
2. **Policy override merge**: The policy's own stored `config` is deep-merged on top of the compiled component result, giving the policy-level settings highest precedence.
3. **Sanitization**: The merged result is cleaned of null/undefined/empty values via `sanitizeConfig`.
4. **Transactional update**: Within a `FOR UPDATE` transaction:
   - The policy row is locked to prevent version race conditions.
   - A new `policy_versions` entry is created with the change summary "Component recompilation".
   - The policy's `config` and `version` are updated.
5. **Blob storage** (best-effort): The compiled config is stored as `{policyId}/v{version}.json` in the `policy-artifacts` blob store.
6. **AMAPI sync** (best-effort): The generated payload is diffed against the previous version to compute an update mask, then patched to AMAPI. The `policies.amapi_name` is updated on success.
7. **Derivative sync** (best-effort): All derivative scopes are re-synced via `syncPolicyDerivativesForPolicy` to propagate the changes to scope-specific AMAPI policies.

Steps 5-7 are wrapped in try/catch to ensure the core DB update (step 4) succeeds even if downstream syncs fail.
