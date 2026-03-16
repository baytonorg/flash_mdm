# `netlify/functions/_lib/amapi-policy-validation.ts`

> Comprehensive preflight validation of entire AMAPI policy payloads against known API constraints, limits, and cross-field rules.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `AmapiPolicyValidationError` | `class extends Error` | Error with an `issues: string[]` property, thrown when policy validation fails |
| `AmapiPolicyValidationResult` | `type` | `{ errors: string[]; warnings: string[] }` |
| `validateAmapiPolicyPayload` | `(payload: unknown) => AmapiPolicyValidationResult` | Validates a full AMAPI policy object, returning categorized errors and warnings |
| `assertValidAmapiPolicyPayload` | `(payload: unknown) => void` | Calls `validateAmapiPolicyPayload` and throws `AmapiPolicyValidationError` if any errors exist |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `asObject` | 21-24 | Safely coerces value to a plain object or returns null |
| `asArray` | 26-28 | Safely coerces value to an array or returns empty array |
| `asString` | 30-32 | Returns value if string, otherwise null |
| `asNumber` | 34-36 | Returns value if finite number, otherwise null |
| `hasDuplicates` | 38-40 | Checks if a string array has duplicates via Set comparison |
| `enumerateAnnualRange` | 42-51 | Enumerates day-of-year ordinals in a circular range (for freeze period overlap detection) |
| `toOrdinalDate` | 53-66 | Converts an AMAPI date object `{ month, day }` to a day-of-year ordinal number |
| `collectOverlongStrings` | 68-92 | Recursively walks a JSON tree to find strings exceeding a max length |

## Key Logic

`validateAmapiPolicyPayload` performs an extensive set of validations organized by policy section. Key checks include:

**Application-level rules:**
- Max 3000 applications; max 20 with `minimumVersionCode`; max 1 with `extensionConfig`; max 1 with `installType=KIOSK`.
- `installType=CUSTOM` requires `signingKeyCerts` and disallows several fields (`minimumVersionCode`, `accessibleTrackIds`, `autoUpdateMode`, `installConstraint`, `installPriority`).
- Role uniqueness across applications (each `roleType` can only be assigned to one app).
- `KIOSK` role and `installType=KIOSK` are mutually exclusive.
- `extensionConfig` and `COMPANION_APP` role are mutually exclusive.
- `CERT_SELECTION` delegated scope conflicts with `choosePrivateKeyRules`.
- Managed configuration string length checks (max 65535 chars).

**Top-level policy rules:**
- `setupActions` max 1 item; referenced package must exist in `applications[]` with `REQUIRED_FOR_SETUP`.
- Deprecated field warnings (`autoTimeRequired` vs `autoDateAndTimeZone`, `tetheringConfigDisabled` vs `tetheringSettings`, `wifiConfigDisabled` vs `configureWifi`).
- `passwordRequirements` deprecated fields and complexity quality restrictions.
- `personalUsagePolicies.maxDaysWithWorkOff` must be 0 or >= 3.
- `policyEnforcementRules` must have both `blockAction` and `wipeAction` together, with `blockAfterDays < wipeAfterDays`.

**Connectivity management:**
- Private DNS host required/forbidden based on mode.
- WiFi roaming settings require unique SSIDs.
- WiFi SSID allowlist must be non-empty.
- Preferential network config consistency (no duplicate IDs, valid cross-references from applications).
- APN settings validation (required fields, type/network type enums, conflict detection via tuple comparison).

**Display settings:**
- Screen brightness range 0-255 with mode consistency checks.
- Screen timeout mode/value consistency.

**System update freeze periods:**
- Valid date ranges, max 90 days per period, no overlaps, minimum 60-day gap between periods.

**Other checks:**
- Duplicate detection in `permittedInputMethods`, `permittedAccessibilityServices`, `accountTypesWithManagementDisabled`, `stayOnPluggedModes`, `wipeDataFlags`.
- Package name format validation via regex `^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$`.
- `choosePrivateKeyRules` URL pattern regex validation.
- `crossProfilePolicies` exemption/mode consistency.
- `defaultApplicationSettings` cross-referencing with `applications[]`.
- `oncCertificateProviders` signing cert SHA-256 validation.
- `complianceRules` max 100, with `minApiLevel > 0`.
