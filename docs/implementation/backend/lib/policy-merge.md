# `netlify/functions/_lib/policy-merge.ts`

> Shared helpers for merging ONC (Wi-Fi), APN network deployments, and removing network entries from a policy config object.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `upsertOncDeploymentInPolicyConfig` | `(config: Record<string, unknown>, deploymentDocument: Record<string, unknown>) => boolean` | Merges an ONC Wi-Fi deployment into `config.openNetworkConfiguration`, returning whether the config changed |
| `upsertApnDeploymentInPolicyConfig` | `(config: Record<string, unknown>, incomingApnPolicy: Record<string, unknown>) => boolean` | Merges an APN policy into `config.deviceConnectivityManagement.apnPolicy`, returning whether the config changed |
| `parseOncDocument` | `(value: unknown) => Record<string, unknown>` | Parses an ONC document from string or object, returning a default empty structure if invalid |
| `parseApnPolicy` | `(value: unknown) => Record<string, unknown>` | Parses an APN policy object, returning a default empty structure if invalid |
| `getApnSettingKey` | `(value: unknown) => string` | Computes a composite key for an APN setting: `displayName\|apn\|numericOperatorId` |
| `removeOncDeploymentFromPolicyConfig` | `(config: Record<string, unknown>, guid: string, ssid: string) => boolean` | Removes a Wi-Fi network entry by GUID or SSID, returning whether the config changed |
| `removeApnDeploymentFromPolicyConfig` | `(config: Record<string, unknown>, apnSettingKey: string) => boolean` | Removes an APN setting by its composite key, returning whether the config changed |

## Key Logic

This module is the single source of truth for how network configurations are merged into and removed from AMAPI policy config objects. It is used by both `network-deploy.ts` (direct deploy flow) and `policy-generation.ts` (generated payload flow) to prevent drift.

**ONC (Wi-Fi) merging:**
- The `openNetworkConfiguration` field is an AMAPI Struct (JSON object), not a string.
- Incoming `NetworkConfigurations` entries are matched against existing ones by GUID first, then by SSID.
- Matched entries are replaced in-place; unmatched entries are appended.
- The document always includes `Type: 'UnencryptedConfiguration'`.
- Change detection uses serialized JSON comparison.

**APN merging:**
- APN settings live at `config.deviceConnectivityManagement.apnPolicy.apnSettings`.
- Incoming settings are matched by a composite key of `displayName|apn|numericOperatorId`.
- The `overrideApns` field is preserved from the existing policy unless explicitly provided in the incoming data.

**Removal:**
- ONC removal deletes the entire `openNetworkConfiguration` field if no networks remain.
- APN removal cleans up the `deviceConnectivityManagement` object hierarchy if it becomes empty.
