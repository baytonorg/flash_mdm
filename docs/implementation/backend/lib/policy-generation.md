# `netlify/functions/_lib/policy-generation.ts`

> Generates final AMAPI policy payloads by layering base policy JSON with scoped app/network deployments and overrides.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `PolicyScopeType` | `type` | `'environment' \| 'group' \| 'device'` |
| `PolicyGenerationTarget` | `type` | Auto target or explicit scope target |
| `PolicyGenerationMetadata` | `type` | Generation metadata (assignment decisions, overrides, lock state, variable detection) |
| `GeneratedPolicyPayload` | `type` | `{ payload, metadata }` output |
| `computePolicyGenerationHash` | `(payload, metadata) => string` | Deterministic SHA-256 hash for no-op detection |
| `buildGeneratedPolicyPayload` | `(input) => Promise<GeneratedPolicyPayload>` | Main merge pipeline |
| `detectDeviceScopedVariables` | `(value: unknown) => string[]` | Detects namespaced variable tokens requiring per-device derivatives |

## Internal Functions

| Name | Description |
|------|-------------|
| `normalizeAmapiCompatibilityFields` | Moves legacy top-level `privateDnsSettings` into `deviceConnectivityManagement.privateDnsSettings` |
| `resolveGenerationTarget` | Resolves generation scope from assignments/explicit target |
| `applyScopedAppDeployments` | Applies app overlays across environment → group chain → device |
| `applyScopedNetworkDeployments` | Applies ONC/APN overlays across environment → group chain → device |
| `loadAndApplyGroupOverrides` | Applies inherited group overrides while enforcing lock constraints |
| `loadAndApplyDeviceOverrides` | Applies device overrides with lock checks |
| `extractVariableTokens` | Extracts `${namespace.key}` tokens from strings |

## Variable Detection Behaviour

`detectDeviceScopedVariables` now treats only `${...}` placeholders as variable syntax and only when namespaced as one of:

- `device.*`
- `user.*`
- `group.*`
- `environment.*`

Detected tokens are lowercased and sorted in metadata. Legacy token styles (`$var`, `var$`) are intentionally ignored.

## Generation Pipeline Summary

1. Clone base policy config.
2. Resolve target scope.
3. Apply scoped app deployments.
4. Apply scoped network deployments.
5. Apply group and device overrides with lock enforcement.
6. Detect namespaced variables and set `requires_per_device_derivative` when needed.
7. Normalize compatibility fields and return payload + metadata.
