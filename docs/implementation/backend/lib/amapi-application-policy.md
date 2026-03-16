# `netlify/functions/_lib/amapi-application-policy.ts`

> Validates individual AMAPI application policy fragments and provides install type constants/guards.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `AMAPI_APPLICATION_INSTALL_TYPES` | `readonly string[]` | All valid AMAPI application install types: `INSTALL_TYPE_UNSPECIFIED`, `PREINSTALLED`, `FORCE_INSTALLED`, `BLOCKED`, `AVAILABLE`, `REQUIRED_FOR_SETUP`, `KIOSK`, `CUSTOM` |
| `AmapiApplicationInstallType` | `type` | Union type of all valid install type string literals |
| `isAmapiApplicationInstallType` | `(value: unknown) => value is AmapiApplicationInstallType` | Type guard that checks if a value is a valid AMAPI application install type |
| `validateAmapiApplicationPolicyFragment` | `(value: unknown) => string[]` | Validates a single application policy object and returns an array of error messages (empty if valid) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `asObject` | 20-23 | Safely coerces a value to a plain object or returns null |
| `asArray` | 25-27 | Safely coerces a value to an array or returns empty array |
| `asString` | 29-31 | Returns the value if it is a string, otherwise null |
| `hasDuplicates` | 33-35 | Checks if a string array contains duplicate values |

## Key Logic

`validateAmapiApplicationPolicyFragment` performs the following checks on a single application policy entry:

1. **installConstraint**: At most 1 item allowed (AMAPI rejects multiple).
2. **installPriority**: Must be between 0 and 10000 inclusive.
3. **roles**: Each role must have a non-`ROLE_TYPE_UNSPECIFIED` `roleType`, and no duplicate `roleType` values are permitted.
4. **signingKeyCerts**: Each certificate fingerprint (whether a plain string or `{ signingKeyCertFingerprintSha256 }` object) must be a valid 64-character SHA-256 hex string.
5. **extensionConfig.signingKeyFingerprintsSha256**: Same SHA-256 hex validation as signing key certs.
