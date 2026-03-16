# `netlify/functions/_lib/amapi-command.ts`

> Builds and validates AMAPI device command payloads for all supported command types.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `BuildAmapiCommandOptions` | `interface` | Options for command building; `allowUnknown` permits unrecognized command types to pass through |
| `AmapiCommandValidationError` | `class extends Error` | Thrown when command parameters fail validation |
| `buildAmapiCommandPayload` | `(type: string, params?: Record<string, unknown>, options?: BuildAmapiCommandOptions) => Record<string, unknown>` | Constructs a validated AMAPI command payload for the given command type |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `asObject` | n/a | Safely coerces a value to a plain object or returns empty object |
| `toNonEmptyString` | n/a | Extracts a trimmed non-empty string or returns undefined |
| `toUserFacingMessage` | n/a | Wraps a string or `{ defaultMessage }` object into an AMAPI `{ defaultMessage }` structure |

## Key Logic

The function `buildAmapiCommandPayload` uses a switch statement to handle each AMAPI command type with type-specific parameter extraction and validation. Enum validation is delegated to shared constants/guards in `_lib/device-commands.ts` so command values stay aligned across single-device, bulk, and worker command paths.

- **Simple commands** (`LOCK`, `REBOOT`, `RELINQUISH_OWNERSHIP`): Return the command type with no additional parameters.
- **STOP_LOST_MODE**: Returns an explicit empty params object (`stopLostModeParams: {}`) with the command type.
- **RESET_PASSWORD**: Optionally includes `newPassword`; validates `resetPasswordFlags` when provided (must be an array of supported enum values).
- **START_LOST_MODE**: Builds `startLostModeParams` from organization, message, phone, address, and email fields, wrapping text fields in `{ defaultMessage }` format. Supports both direct params and nested `startLostModeParams` object, with camelCase and snake_case field variants (e.g., `lostOrganization` / `organization` / `lost_organization`). `toUserFacingMessage()` handles both plain strings and nested `{ defaultMessage }` objects. Validates that at least one field is provided.
- **CLEAR_APP_DATA**: Requires either a single `packageName` or an array of `packageNames`. Throws `AmapiCommandValidationError` if neither is provided.
- **REQUEST_DEVICE_INFO**: Validates `deviceInfo` against supported enum values (`DEVICE_INFO_UNSPECIFIED`, `EID`). Defaults to `EID` when omitted.
- **ADD_ESIM**: Requires `activationCode`, validates `activationState` against allowed enum values.
- **WIPE**: Optionally includes `wipeReason` and `wipeDataFlags`, filtering flags against a whitelist of valid values (`WIPE_DATA_FLAG_UNSPECIFIED`, `PRESERVE_RESET_PROTECTION_DATA`, `WIPE_EXTERNAL_STORAGE`, `WIPE_ESIMS`).
- **REMOVE_ESIM**: Requires `iccId`, throws if missing.
- **Unknown types**: Rejected by default; when `allowUnknown` is true, passes through remaining params as-is.

Parameter resolution supports both flat and nested input shapes (e.g., `params.activationCode` or `params.addEsimParams.activationCode`), and accepts both camelCase and snake_case variants for some fields.
